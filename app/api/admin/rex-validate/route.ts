import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { rexConfigured, rexCall, rexRows, rexLettingsAgents } from "@/lib/rex";

// Round 2 of funnel validation (?month=YYYY-MM, default June — a month with
// known final figures: 40 MAs / 35 listings / 202 viewings / 25 applications).
// Round 1 established: Listings.system_ctime=21 vs Susan's 35 (undercounts),
// TenancyApplications.date_received isn't searchable, system_ctime returned 0
// (format issue?), and CalendarEvents EXISTS with appointment_type/starts_at.
// This round: ask REX itself for each model's fields (describeModel), count
// June CalendarEvents by appointment type (paged), and retry applications
// with proper datetime formats + a client-side date_received count.

export const maxDuration = 120;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

type Crit = Array<{ name: string; type: string; value: string | string[] }>;

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = userId ? await findById(userId) : null;
  if (!admin || !isAdminEmail(admin.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!rexConfigured()) return NextResponse.json({ configured: false });

  const monthParam = req.nextUrl.searchParams.get("month");
  const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : "2026-06";
  const { start, end } = monthRange(month);
  const agents = await rexLettingsAgents();
  const agentIds = agents.map((a) => a.id);

  async function tryCount(service: string, criteria: Crit): Promise<number | string> {
    try {
      const res = await rexCall(service, "search", { criteria, limit: 100 });
      if (!res.ok) return `ERR ${res.status}: ${res.error ?? "?"}`;
      return rexRows(res.result).length;
    } catch (e) {
      return `ERR: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // Fetch up to `max` rows via offset paging (REX caps a page at 100).
  async function pagedRows(
    service: string,
    criteria: Crit,
    max = 600
  ): Promise<{ rows: Array<Record<string, unknown>>; capped: boolean } | string> {
    const rows: Array<Record<string, unknown>> = [];
    for (let offset = 0; offset < max; offset += 100) {
      try {
        const res = await rexCall(service, "search", { criteria, limit: 100, offset });
        if (!res.ok) return `ERR ${res.status}: ${res.error ?? "?"}`;
        const page = rexRows(res.result);
        rows.push(...page);
        if (page.length < 100) return { rows, capped: false };
      } catch (e) {
        return `ERR: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    return { rows, capped: true };
  }

  // --- REX's own field lists — the end of guessing date-field names. ---
  // describeModel payloads are big; keep just the field names.
  async function fieldNames(model: string): Promise<string[] | string> {
    try {
      const res = await rexCall(model, "describeModel", {});
      if (!res.ok) return `ERR ${res.status}: ${res.error ?? "?"}`;
      const r = res.result as Record<string, unknown>;
      // Known shapes: { fields: {name: …} } or { fields: [{name}] } — fall back
      // to top-level keys so we at least see the shape to dig into next round.
      const f = r?.fields;
      if (Array.isArray(f)) {
        return f.map((x) => String((x as { name?: string })?.name ?? x)).sort();
      }
      if (f && typeof f === "object") return Object.keys(f).sort();
      return Object.keys(r ?? {});
    } catch (e) {
      return `ERR: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const [listingFields, applicationFields, calendarFields] = await Promise.all([
    fieldNames("Listings"),
    fieldNames("TenancyApplications"),
    fieldNames("CalendarEvents"),
  ]);

  // --- Viewings: June CalendarEvents grouped by appointment type. ---
  // No agent filter yet — first see what types exist and the monthly volume
  // (Susan's June viewings: 202).
  const calendar: Record<string, unknown> = {};
  const calRes = await pagedRows("CalendarEvents", [
    { name: "starts_at", type: ">=", value: `${start} 00:00:00` },
    { name: "starts_at", type: "<=", value: `${end} 23:59:59` },
  ]);
  if (typeof calRes === "string") {
    calendar.error = calRes;
  } else {
    const byType: Record<string, number> = {};
    const organiserDomains: Record<string, number> = {};
    for (const r of calRes.rows) {
      const t = r.appointment_type;
      const label =
        t && typeof t === "object"
          ? String((t as { text?: string; id?: string }).text ?? (t as { id?: string }).id)
          : String(t ?? "none");
      byType[label] = (byType[label] ?? 0) + 1;
      const email = String(r.remote_organiser_email ?? "");
      const dom = email.includes("@") ? email.split("@")[1].toLowerCase() : "none";
      organiserDomains[dom] = (organiserDomains[dom] ?? 0) + 1;
    }
    calendar.total = calRes.rows.length;
    calendar.capped = calRes.capped;
    calendar.byAppointmentType = byType;
    calendar.organiserDomains = organiserDomains;
    const sample = calRes.rows[0];
    calendar.sampleRow = sample
      ? {
          title: sample.title,
          appointment_type: sample.appointment_type,
          starts_at: sample.starts_at,
          organiser: sample.remote_organiser_email,
          calendar: sample.calendar,
        }
      : null;
  }

  // --- Applications: datetime-format variants + client-side count. ---
  const applications: Record<string, number | string> = {};
  applications["system_ctime datetime"] = await tryCount("TenancyApplications", [
    { name: "application.agent_id", type: "in", value: agentIds },
    { name: "system_ctime", type: ">=", value: `${start} 00:00:00` },
    { name: "system_ctime", type: "<=", value: `${end} 23:59:59` },
  ]);
  applications["system_ctime epoch"] = await tryCount("TenancyApplications", [
    { name: "application.agent_id", type: "in", value: agentIds },
    { name: "system_ctime", type: ">=", value: String(Date.parse(`${start}T00:00:00Z`) / 1000) },
    { name: "system_ctime", type: "<=", value: String(Date.parse(`${end}T23:59:59Z`) / 1000) },
  ]);
  // Client-side: latest applications for our agents, count date_received in month.
  const appRes = await pagedRows(
    "TenancyApplications",
    [{ name: "application.agent_id", type: "in", value: agentIds }],
    600
  );
  if (typeof appRes === "string") {
    applications["client-side date_received"] = appRes;
  } else {
    const inMonth = appRes.rows.filter((r) => {
      const d = String(r.date_received ?? "");
      return d >= start && d <= `${end}~`;
    }).length;
    applications["client-side date_received"] = inMonth;
    applications["client-side rows fetched"] = `${appRes.rows.length}${appRes.capped ? " (CAPPED — real count may be higher)" : ""}`;
  }

  // --- Listings: round-1 counts again for reference. ---
  const listings: Record<string, number | string> = {
    system_ctime: await tryCount("Listings", [
      { name: "listing_agent_1_id", type: "in", value: agentIds },
      { name: "system_ctime", type: ">=", value: `${start} 00:00:00` },
      { name: "system_ctime", type: "<=", value: `${end} 23:59:59` },
    ]),
    available_from_date: await tryCount("Listings", [
      { name: "listing_agent_1_id", type: "in", value: agentIds },
      { name: "available_from_date", type: ">=", value: start },
      { name: "available_from_date", type: "<=", value: end },
    ]),
  };

  return NextResponse.json({
    configured: true,
    month,
    agentsMatched: agents.length,
    susansFinals: { note: "June finals from her dashboard", mas: 40, listings: 35, viewings: 202, applications: 25, moveIns: 30 },
    calendar,
    applications,
    listings,
    modelFields: {
      Listings: listingFields,
      TenancyApplications: applicationFields,
      CalendarEvents: calendarFields,
    },
  });
}
