import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { getAgentFunnel, getAgentPortfolio } from "@/lib/rex-stats";
import { getPropolyPipelineCount } from "@/lib/propoly-deals";
import { getMoveIns } from "@/lib/payprop-income";
import { getAgentBook } from "@/lib/payprop-portfolio";
import { resolveRexUserId } from "@/lib/agent-link";
import { getAgentMetaStats } from "@/lib/meta";
import { getOverrides } from "@/lib/actuals-store";
import { resolveStat, pct, type ManualOverride } from "@/lib/stats";
import {
  agentSeedStats,
  agentMoveIns,
  agentPipeline,
  agentCompliance,
  agentNetIncomeYtd,
  agentPortfolio,
  SNAPSHOT_DATE,
} from "@/lib/seed-data";
import { formatGBP, formatPct, currentMonth } from "@/lib/format";
import type { ActualOverride, ConversionStats, FunnelStats, StatValue } from "@/lib/types";

// GET /api/my/stats?month=YYYY-MM — the signed-in agent's funnel + conversion
// stats for one month, assembled with the live → manual → snapshot precedence:
//   live     = best-effort REX pull (skipped when no rexUserId is linked)
//   manual   = admin overrides from the actuals store (scope agent + agentKey)
//   snapshot = Susan's Base44 dashboard capture via agentSeedStats(agentKey)
// Plus the agent's seed move-ins / pipeline / compliance / net-income rows.
// Defensive throughout: an integration failure NEVER breaks the response —
// every stat degrades to the snapshot (or a null StatValue).

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const FUNNEL_FIELDS = [
  "marketAppraisals",
  "listings",
  "viewings",
  "applications",
  "moveIns",
  "pipeline",
  "liveListings",
  "gci",
] as const;

type FunnelField = (typeof FUNNEL_FIELDS)[number];

function nullStat(): StatValue {
  return { value: null, source: "snapshot", asOf: SNAPSHOT_DATE };
}

function nullFunnel(): FunnelStats {
  return {
    marketAppraisals: nullStat(),
    listings: nullStat(),
    viewings: nullStat(),
    applications: nullStat(),
    moveIns: nullStat(),
    pipeline: nullStat(),
    gci: nullStat(),
  };
}

/**
 * Merge one funnel stat. A live StatValue from rex-stats already carries the
 * right source/note/asOf, so it wins as-is; otherwise fall through
 * manual → snapshot via resolveStat.
 */
function mergeStat(
  live: StatValue | undefined,
  manual: ManualOverride | null,
  snapshot: StatValue | undefined
): StatValue {
  if (live && live.value != null && !Number.isNaN(live.value)) return live;
  return resolveStat(null, manual, snapshot ?? nullStat());
}

/** Manual override for one funnel field, from the actuals store rows. */
function overrideFor(
  overrides: ActualOverride[],
  agentKey: string | null,
  field: FunnelField
): ManualOverride | null {
  if (!agentKey) return null;
  const metric = `funnel.${field}`;
  const row = overrides.find(
    (o) => o.scope === "agent" && o.agentKey === agentKey && o.metric === metric
  );
  return row ? { value: row.value, note: row.note ?? "Admin-entered figure" } : null;
}

/**
 * A conversion derived from other stats inherits the WEAKEST source involved:
 * derived-from-anything-live/manual → "derived"; all-snapshot inputs → the
 * badge stays "snapshot" so nobody mistakes it for a live calculation.
 */
function conversionStat(
  value: number | null,
  inputs: StatValue[],
  note: string
): StatValue {
  const allSnapshot =
    inputs.length > 0 && inputs.every((s) => s.source === "snapshot");
  return {
    value,
    display: formatPct(value),
    source: allSnapshot ? "snapshot" : "derived",
    note,
    asOf: allSnapshot ? SNAPSHOT_DATE : new Date().toISOString().slice(0, 10),
  };
}

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const user = await findById(userId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const monthParam = req.nextUrl.searchParams.get("month");
  const month =
    monthParam && MONTH_RE.test(monthParam) ? monthParam : currentMonth();
  const agentKey = user.agentKey;
  // Links them on the fly if they signed up before we auto-linked at signup —
  // otherwise their live layer silently stays empty and they see snapshot only.
  const rexUserId = await resolveRexUserId(user);

  // Gather the layers in parallel — each one degrades to null/[] alone.
  const [live, livePortfolio, meta, overrides, propolyPipeline] = await Promise.all([
    rexUserId
      ? getAgentFunnel(rexUserId, month).catch(() => null)
      : Promise.resolve(null),
    rexUserId
      ? getAgentPortfolio(rexUserId).catch(() => null)
      : Promise.resolve(null),
    getAgentMetaStats(user).catch(() => ({ configured: false as const })),
    getOverrides(month).catch(() => [] as ActualOverride[]),
    getPropolyPipelineCount({ email: user.email, agentKey: user.agentKey ?? null }).catch(
      () => null
    ),
  ]);

  const snapshot = agentKey ? agentSeedStats(agentKey) : nullFunnel();

  // ---- Funnel: field-by-field live → manual → snapshot merge ----
  const funnel = {} as FunnelStats;
  for (const field of FUNNEL_FIELDS) {
    const merged = mergeStat(
      live?.[field],
      overrideFor(overrides, agentKey, field),
      snapshot[field]
    );
    if (field === "liveListings") {
      if (merged.value != null || snapshot.liveListings) funnel.liveListings = merged;
      continue;
    }
    funnel[field as Exclude<FunnelField, "liveListings">] = merged;
  }
  // GCI is money — make sure it renders as £ even when live/manual (no display).
  if (funnel.gci && !funnel.gci.display && funnel.gci.value != null) {
    funnel.gci = { ...funnel.gci, display: formatGBP(funnel.gci.value) };
  }

  // Pipeline: Propoly outranks everything — it's the system actually running
  // the progression, counted per agent via their property-manager email.
  if (propolyPipeline != null) {
    funnel.pipeline = {
      value: propolyPipeline,
      source: "live-propoly",
      note: "Live count of your deals in progression on Propoly — deal started through signing & move-in monies.",
      asOf: new Date().toISOString().slice(0, 10),
    };
  }

  // Move-ins: PayProp knows which tenancies started this month and the
  // portfolio book knows whose properties they are, so the two join on
  // property name. Without this the tile sat on the snapshot — and it also
  // feeds Listing -> Move-in, which was therefore derived from stale numbers.
  const allMoveIns = getMoveIns(month);
  const book = getAgentBook(user.name ?? "");
  if (allMoveIns && book && book.propertyNames.length) {
    const mine = new Set(book.propertyNames);
    const rows = allMoveIns.properties.filter((p) => mine.has(p.property));
    funnel.moveIns = {
      value: rows.length,
      source: "live-payprop",
      note: `Live from PayProp — tenancies starting this month on your properties${
        rows.length ? `, adding ${formatGBP(rows.reduce((t, r) => t + (r.rent ?? 0), 0))} of rent` : ""
      }.`,
      asOf: new Date().toISOString().slice(0, 10),
    };
  }

  // ---- Conversions (derived; badge inherits the weakest input source) ----
  const mas = funnel.marketAppraisals;
  const listings = funnel.listings;
  const moveIns = funnel.moveIns;

  const metaLeads =
    meta.configured && "snapshot" in meta && meta.snapshot
      ? meta.snapshot.leads
      : null;
  const metaLeadsStat: StatValue | null =
    metaLeads != null
      ? {
          value: metaLeads,
          source: "live-meta",
          asOf: new Date().toISOString().slice(0, 10),
        }
      : null;

  const leadToMa: StatValue = metaLeadsStat
    ? conversionStat(
        pct(mas.value, metaLeadsStat.value),
        [mas, metaLeadsStat],
        `${mas.value ?? "—"} MAs from ${metaLeads} Meta leads (last 30 days)`
      )
    : {
        value: null,
        source: "derived",
        note:
          "Needs your live Meta leads count — ask the admin to link your ad campaign to see this.",
      };

  const conversions: ConversionStats = {
    leadToMa,
    maToListing: conversionStat(
      pct(listings.value, mas.value),
      [listings, mas],
      `${listings.value ?? "—"} listings from ${mas.value ?? "—"} market appraisals`
    ),
    listingToMoveIn: conversionStat(
      pct(moveIns.value, listings.value),
      [moveIns, listings],
      `${moveIns.value ?? "—"} move-ins from ${listings.value ?? "—"} listings`
    ),
  };

  if (funnel.gci?.value != null && moveIns.value != null && moveIns.value > 0) {
    const perMoveIn = funnel.gci.value / moveIns.value;
    const allSnapshot =
      funnel.gci.source === "snapshot" && moveIns.source === "snapshot";
    conversions.gciPerMoveIn = {
      value: perMoveIn,
      display: formatGBP(perMoveIn),
      source: allSnapshot ? "snapshot" : "derived",
      note: `${formatGBP(funnel.gci.value)} GCI ÷ ${moveIns.value} move-ins`,
      asOf: allSnapshot ? SNAPSHOT_DATE : new Date().toISOString().slice(0, 10),
    };
  }

  // ---- Portfolio (managed properties + monthly rent roll) ----
  // Live REX (leased listings) → snapshot PayProp figures.
  const snapPortfolio = agentKey ? agentPortfolio(agentKey) : null;
  const portfolio = {
    managed:
      livePortfolio != null
        ? ({
            value: livePortfolio.managed,
            source: "live-rex",
            note: "Live count of your managed (let) properties in REX.",
            asOf: new Date().toISOString().slice(0, 10),
          } as StatValue)
        : ({
            value: snapPortfolio?.managed ?? null,
            source: "snapshot",
            note: "Managed properties from the PayProp portfolio snapshot.",
            asOf: SNAPSHOT_DATE,
          } as StatValue),
    rentRoll:
      livePortfolio != null
        ? ({
            value: livePortfolio.rentRoll,
            display: formatGBP(livePortfolio.rentRoll),
            source: "live-rex",
            note: "Live monthly rent roll (sum of rent across your let properties in REX).",
            asOf: new Date().toISOString().slice(0, 10),
          } as StatValue)
        : ({
            value: snapPortfolio?.rentRoll ?? null,
            display: snapPortfolio ? formatGBP(snapPortfolio.rentRoll) : undefined,
            source: "snapshot",
            note: "Monthly rent roll from the PayProp portfolio snapshot.",
            asOf: SNAPSHOT_DATE,
          } as StatValue),
  };

  return NextResponse.json({
    month,
    agentKey,
    funnel,
    conversions,
    portfolio,
    // Full snapshot mix (managed / let-only / RLP / avg rent) for the donut.
    portfolioDetail: snapPortfolio,
    moveIns: agentKey ? agentMoveIns(agentKey) : [],
    pipeline: agentKey ? agentPipeline(agentKey) : [],
    compliance: agentKey ? agentCompliance(agentKey) : null,
    netIncomeYtd: agentKey ? agentNetIncomeYtd(agentKey) : null,
  });
}
