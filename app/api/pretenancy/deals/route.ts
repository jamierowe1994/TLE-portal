import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { isPreTenancyEmail } from "@/lib/brand";
import { findById } from "@/lib/users-store";
import { getAllPropolyDeals, getPropolyMoveInForecast } from "@/lib/propoly-deals";
import { effectiveStatusKey, getOverlays } from "@/lib/deal-store";
import { PROPOLY_STAGES } from "@/lib/propoly-stages";
import type { DealPortalOverlay } from "@/lib/types";

// GET /api/pretenancy/deals — every Propoly deal across all TLE agents with
// the portal overlay (notes, stage moves, checklist) merged in, plus the
// headline numbers for the top of Kirstie's dashboard. Gate: pre-tenancy
// role or admin (Susan can look over Kirstie's board).

export interface PreTenancyDeal {
  // AgentApplication fields the board renders, via the same shape the agent sees
  app: import("@/lib/rex-stats").AgentApplication;
  /** Live Propoly status. */
  statusKey: string;
  /** Status after Kirstie's still-valid stage move (== statusKey if none). */
  effectiveStatusKey: string;
  agentName: string | null;
  agentEmail: string | null;
  portal: DealPortalOverlay;
}

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user || (!isPreTenancyEmail(user.email) && !isAdminEmail(user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [deals, forecast] = await Promise.all([
    getAllPropolyDeals().catch(() => null),
    getPropolyMoveInForecast().catch(() => null),
  ]);
  if (deals == null) {
    // Distinguish "no keys" from "cold cache didn't warm inside the deadline"
    // — the client retries the latter instead of claiming Propoly is missing.
    const { propolyConfigured } = await import("@/lib/propoly");
    return NextResponse.json({
      configured: propolyConfigured(),
      deals: null,
      summary: null,
    });
  }

  const overlays = await getOverlays(deals.map((d) => d.app.id));
  const today = new Date().toISOString().slice(0, 10);

  const out: PreTenancyDeal[] = deals.map((d) => {
    const entry = overlays.get(d.app.id);
    const meta = entry?.meta ?? null;
    const effective = effectiveStatusKey(d.statusKey, meta);
    const overlay: DealPortalOverlay = entry
      ? {
          ...entry.overlay,
          // A stage move Propoly has since overtaken is stale — don't show it.
          override: effective === d.statusKey ? null : entry.overlay.override,
        }
      : { notesCount: 0, lastNote: null, override: null, checklistDone: 0, checklistTotal: 0 };
    return {
      app: d.app,
      statusKey: d.statusKey,
      effectiveStatusKey: effective,
      agentName: d.managerName,
      agentEmail: d.managerEmail,
      portal: overlay,
    };
  });

  const active = out.filter(
    (d) => d.statusKey !== "cancelled" && d.statusKey !== "complete"
  );
  const summary = {
    pipelineTotal: active.length,
    byStage: PROPOLY_STAGES.map((s) => ({
      key: s.key,
      label: s.label,
      count: active.filter((d) => d.effectiveStatusKey === s.key).length,
    })),
    overdue: active.filter((d) => d.app.startDate != null && d.app.startDate < today).length,
    undated: active.filter((d) => d.app.startDate == null).length,
    completedMtd: forecast?.completedMtd ?? null,
    forecastByMonth: forecast?.forecastByMonth ?? null,
  };

  return NextResponse.json({ configured: true, deals: out, summary });
}
