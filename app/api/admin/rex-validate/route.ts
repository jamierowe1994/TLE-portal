import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { rexConfigured, rexCall, rexRows, rexLettingsAgents } from "@/lib/rex";

// Date-semantics validation for the funnel figures we want live. For a given
// month (?month=YYYY-MM) it counts each candidate interpretation so the
// numbers can be compared against Susan's dashboard side by side, and probes
// candidate services for VIEWINGS (the one funnel stat with no known home).
// Compare e.g. June: Susan says 22 listings, 98 viewings, 22 applications
// (January) etc. — whichever candidate matches her column is the right field.
//
// Heavier than the 8s page budget on purpose — it's a diagnostic you wait for.

export const maxDuration = 60;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = userId ? await findById(userId) : null;
  if (!admin || !isAdminEmail(admin.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!rexConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const monthParam = req.nextUrl.searchParams.get("month");
  const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : "2026-06";
  const { start, end } = monthRange(month);
  const agents = await rexLettingsAgents();
  const agentIds = agents.map((a) => a.id);

  // Count rows for a service + criteria; returns count or the error string.
  async function tryCount(
    service: string,
    criteria: Array<{ name: string; type: string; value: string | string[] }>
  ): Promise<number | string> {
    try {
      const res = await rexCall(service, "search", { criteria, limit: 100 });
      if (!res.ok) return `ERR ${res.status}: ${res.error ?? "?"}`;
      return rexRows(res.result).length;
    } catch (e) {
      return `ERR: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // --- Listings: which date field means "listed this month"? ---
  const listingDateFields = [
    "system_ctime",
    "system_publication_time",
    "inbound_date",
    "date_listed",
    "available_from_date",
  ];
  const listings: Record<string, number | string> = {};
  for (const f of listingDateFields) {
    listings[f] = await tryCount("Listings", [
      { name: "listing_agent_1_id", type: "in", value: agentIds },
      { name: f, type: ">=", value: start },
      { name: f, type: "<=", value: `${end} 23:59:59` },
    ]);
  }

  // --- Applications: date_received vs system_ctime ---
  const applications: Record<string, number | string> = {};
  for (const f of ["date_received", "system_ctime"]) {
    applications[f] = await tryCount("TenancyApplications", [
      { name: "application.agent_id", type: "in", value: agentIds },
      { name: f, type: ">=", value: start },
      { name: f, type: "<=", value: `${end} 23:59:59` },
    ]);
  }

  // --- Viewings: which service even holds them? ---
  // Bare search first (does the service exist / is it readable), then a sample
  // row's keys so we can spot the date + agent fields to filter on.
  const viewingServices = [
    "CalendarEvents",
    "Appointments",
    "Events",
    "Viewings",
    "ListingViewings",
    "Feedback",
  ];
  const viewings: Record<string, { probe: number | string; sampleKeys?: string[] }> = {};
  for (const svc of viewingServices) {
    try {
      const res = await rexCall(svc, "search", { limit: 1 });
      if (!res.ok) {
        viewings[svc] = { probe: `ERR ${res.status}: ${res.error ?? "?"}` };
        continue;
      }
      const rows = rexRows(res.result);
      viewings[svc] = {
        probe: rows.length,
        sampleKeys: rows[0] ? Object.keys(rows[0]).slice(0, 40) : [],
      };
    } catch (e) {
      viewings[svc] = { probe: `ERR: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  return NextResponse.json({
    configured: true,
    month,
    agentsMatched: agents.length,
    counts: { listings, applications },
    viewingServiceProbe: viewings,
    readMe:
      "Compare counts against Susan's dashboard for the same month — the matching field is the one to wire. Viewing services with a number (not ERR) exist; sampleKeys shows what to filter on.",
  });
}
