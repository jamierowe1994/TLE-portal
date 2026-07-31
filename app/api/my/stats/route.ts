import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import {
  getAgentAppraisals,
  getAgentListings,
  getAgentPortfolio,
  getAgentRampCounts,
} from "@/lib/rex-stats";
import { findById } from "@/lib/users-store";
import { getPropolyAgentDeals } from "@/lib/propoly-deals";
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
  SNAPSHOT_MONTH,
} from "@/lib/seed-data";
import { formatGBP, formatPct, monthLabel } from "@/lib/format";
import type {
  ActualOverride,
  AppraisalsDrillRow,
  ConversionStats,
  FunnelRows,
  FunnelStats,
  ListingsDrillRow,
  MoveInsDrillRow,
  PipelineDrillRow,
  StatValue,
} from "@/lib/types";

// GET /api/my/stats?month=YYYY-MM  (one month — the original form, still used
//                                   by the layout prefetch and the forecast page)
// GET /api/my/stats?months=YYYY-MM,YYYY-MM,…  (a period the dashboard's picker
//                                   resolved to a set of months)
//
// The signed-in agent's funnel + conversion stats for ONE PERIOD, assembled
// with the live → manual → snapshot precedence:
//   live     = best-effort REX/PayProp/Propoly pull (skipped when unlinked)
//   manual   = admin overrides from the actuals store (scope agent + agentKey)
//   snapshot = Susan's Base44 dashboard capture via agentSeedStats(agentKey)
// Plus the agent's seed move-ins / pipeline / compliance / net-income rows.
// Defensive throughout: an integration failure NEVER breaks the response —
// every stat degrades to the snapshot (or a null StatValue).
//
// TWO KINDS OF FIGURE live in here and confusing them is the one thing this
// route must never do:
//   period      — a FLOW counted inside the selected months (appraisals,
//                 move-ins, listings instructed). Sums across a range, and can
//                 be computed for any past month.
//   as-at-today — a STOCK read live right now (properties on the market, deals
//                 in progression, the portfolio). There is no stored history of
//                 either, so these have no past-month value at all.
// `funnelBasis[field]` says which a figure is; `unavailable` says why a figure
// has no answer for the selected period. The overwrites below used to hand the
// dashboard today's on-market count and today's Propoly pipeline no matter
// which month was asked for, which is how a partner could read April's heading
// over July's numbers.
//
// Three states have to stay distinguishable on the dashboard, so they stay
// distinguishable here:
//   value != null                   → the answer
//   value == null + unavailable     → can't be computed for this period, and why
//   value == null, no unavailable   → still gathering; the page retries

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The longest window we fan the per-month live pulls out over. A month of
 * appraisals is ~3 REX searches and a month of move-ins is a full walk of
 * PayProp's invoice export, so "Full year" would be forty-odd calls for one
 * page load — enough to blow the REX deadline and return nulls that read as
 * "you had none". Beyond this the month-by-month figures say so instead.
 */
const MAX_FANOUT_MONTHS = 6;

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

/**
 * What a figure is an answer TO. Carried beside the funnel rather than inside
 * StatValue because StatValue is the cross-lane contract in lib/types.ts —
 * adding `basis`/`unavailable` there is the tidier home for this and is
 * described in the handover, but it isn't this workstream's file to change.
 */
export interface FigureMeta {
  basis: "period" | "as-at-today";
  /** What the figure counts, in the words the tile should use. */
  label: string;
  /**
   * Set only when the figure CANNOT be computed for the selected period.
   * Short enough to stand where the number would — a tile is not the place
   * for the whole explanation.
   */
  unavailable?: string;
  /** The rest of the explanation, for the panel that opens underneath. */
  detail?: string;
}

/** A reason in both lengths: on the tile, and in the panel it opens. */
interface Reason {
  short: string;
  detail: string;
}

const reason = (r: Reason | null | undefined) =>
  r ? { unavailable: r.short, detail: r.detail } : {};

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

const today = () => new Date().toISOString().slice(0, 10);

/** Last day of a YYYY-MM, so a range covers the whole final month. */
function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

// Spelled out rather than taken from toLocaleDateString: en-GB gives "Sept" on
// newer ICU builds and the dashboard's own labels say "Sep", so a note and the
// heading above it would disagree about the same month.
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_MONTH = (month: string) => SHORT_MONTHS[Number(month.slice(5, 7)) - 1];

/** "June 2026" / "May–Jul 2026" — how a note names the window it covers. */
function periodPhrase(months: string[]): string {
  if (months.length === 0) return "this period";
  if (months.length === 1) return monthLabel(months[0]);
  const first = months[0];
  const last = months[months.length - 1];
  return `${SHORT_MONTH(first)}–${SHORT_MONTH(last)} ${last.slice(0, 4)}`;
}

/**
 * The months the caller asked for, cleaned up: `?months=` first, `?month=` as
 * the single-month case so the layout prefetch and the forecast page keep
 * working. Anything that hasn't happened yet is split off rather than counted
 * as a zero — an empty August would otherwise drag every average down.
 */
function resolveMonths(params: URLSearchParams, liveMonth: string) {
  const raw = params.get("months") ?? params.get("month") ?? "";
  const asked = [...new Set(raw.split(",").map((m) => m.trim()).filter((m) => MONTH_RE.test(m)))].sort();
  const requested = asked.length ? asked : [liveMonth];
  return {
    requested,
    months: requested.filter((m) => m <= liveMonth),
    future: requested.filter((m) => m > liveMonth),
  };
}

/**
 * Manual override for one funnel field, summed over the period.
 *
 * Only when EVERY month in the window has one: half a period entered by hand
 * is a smaller but entirely plausible number, and nobody looking at it could
 * tell it was short.
 */
function overrideFor(
  perMonth: ActualOverride[][] | null,
  agentKey: string | null,
  field: FunnelField
): ManualOverride | null {
  if (!agentKey || !perMonth || perMonth.length === 0) return null;
  const metric = `funnel.${field}`;
  const rows = perMonth.map((list) =>
    list.find((o) => o.scope === "agent" && o.agentKey === agentKey && o.metric === metric)
  );
  if (rows.some((r) => !r)) return null;
  const value = rows.reduce((total, r) => total + (r as ActualOverride).value, 0);
  return {
    value,
    note:
      rows.length === 1
        ? ((rows[0] as ActualOverride).note ?? "Admin-entered figure")
        : `Admin-entered figures for ${rows.length} months, added up`,
  };
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
    asOf: allSnapshot ? SNAPSHOT_DATE : today(),
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

  // "The live month" — the one month a current-state figure may answer for.
  // It has to be the month the CLIENT anchors to (ANCHOR in
  // app/dashboard/page.tsx and components/PeriodPicker.tsx, both "2026-07"),
  // never the wall clock: every month the picker can offer is derived from that
  // anchor, and the anchor doesn't advance with real time. Reading the clock
  // here meant that from 1 Aug 2026 no selection any partner could make would
  // ever BE the live month — pipeline, the on-market listings definition and
  // Lead → MA would all have gone permanently unavailable on the default view.
  // Keep this pinned to the seed capture the rest of the portal is written
  // against; when the data moves on, SNAPSHOT_MONTH and the two ANCHORs move
  // together.
  const liveMonth = SNAPSHOT_MONTH;
  const { requested, months, future } = resolveMonths(req.nextUrl.searchParams, liveMonth);
  // The month the response is "about" — kept for the callers that still pass
  // ?month= and read the echo back.
  const month = months[months.length - 1] ?? requested[requested.length - 1] ?? liveMonth;
  // The ONE test for "may a current-state figure answer this?". Everything
  // else keys off it rather than string-comparing months in five places.
  const isLiveMonth = months.length === 1 && months[0] === liveMonth;
  const canFanOut = months.length > 0 && months.length <= MAX_FANOUT_MONTHS;
  const phrase = periodPhrase(months);
  const single = months.length === 1;

  const agentKey = user.agentKey;
  // Links them on the fly if they signed up before we auto-linked at signup —
  // otherwise their live layer silently stays empty and they see snapshot only.
  const rexUserId = await resolveRexUserId(user);

  // Why a period figure has no answer. Each is something a partner can act on,
  // not a shrug — short enough for the tile, with the rest a click away.
  const NOTHING_YET: Reason = {
    short: "Hasn't happened yet.",
    detail: `${periodPhrase(future)} is still ahead of us, so there's nothing to count.`,
  };
  const TOO_LONG: Reason = {
    short: `Over ${MAX_FANOUT_MONTHS} months — not counted here.`,
    detail: `Counting this month by month means walking REX and PayProp once per month, which is too much for one page load beyond ${MAX_FANOUT_MONTHS}. Pick a window of ${MAX_FANOUT_MONTHS} months or fewer and it fills in.`,
  };
  const NO_REX_LINK: Reason = {
    short: "REX profile isn't linked.",
    detail:
      "This comes from REX, and your portal account isn't linked to a REX user yet — ask the admin to link it and this fills in.",
  };
  const SEED_ONLY: Reason = {
    short: "Not tracked for past periods.",
    detail: `This figure only exists in the ${monthLabel(SNAPSHOT_MONTH)} dashboard capture — there's no live per-partner source for it yet, so no other period can be answered.`,
  };
  const PIPELINE_LIVE_ONLY: Reason = {
    short: "Live view only.",
    detail:
      "Pipeline counts the deals sitting in a progression stage right now. A deal that was in progression in a past month is complete or cancelled today, and Propoly keeps no record of where it stood back then — so a past-month pipeline can't be rebuilt, only invented.",
  };
  const NO_PROPOLY: Reason = {
    short: "Couldn't reach Propoly.",
    detail:
      "Pipeline is a live read of your deals in progression on Propoly, and Propoly didn't answer this time. There's no history to fall back on — the only other figure we hold is the July snapshot count, which isn't an answer to \"right now\" — so nothing is shown rather than that. A reload usually brings it back; if it never does, Propoly may not be connected to your account and the admin can check.",
  };
  const NO_PAYPROP_BOOK: Reason = {
    short: "No PayProp properties under your name.",
    detail:
      "Move-ins are matched to you through PayProp's property book, and nothing in it is filed under your name — usually because PayProp spells the name differently from the portal. Ask the admin to check the name mapping and this fills in.",
  };

  const rangeStart = months.length ? `${months[0]}-01` : null;
  const rangeEnd = months.length ? monthEnd(months[months.length - 1]) : null;

  // Gather the layers in parallel — each one degrades to null/[] alone.
  // The REX pulls double as the drill-down sources: each funnel figure below is
  // counted from the very array it hands the dashboard, so a tile can never
  // disagree with the list it opens.
  //
  // getAgentFunnel is deliberately NOT called any more. Its market-appraisals
  // leg is getAgentAppraisals (which we call per month anyway) and its listings
  // and pipeline legs are current-state counts that ignored the month — the
  // exact leak this route exists to close.
  const [livePortfolio, meta, overridesByMonth, propolyDeals, liveListings, appraisalsByMonth, instructed] =
    await Promise.all([
      rexUserId ? getAgentPortfolio(rexUserId).catch(() => null) : Promise.resolve(null),
      // Meta's lead count is a rolling 30-day window, so it can only speak for
      // the month we're standing in. Don't even ask for a past period.
      isLiveMonth
        ? getAgentMetaStats(user).catch(() => ({ configured: false as const }))
        : Promise.resolve({ configured: false as const }),
      canFanOut
        ? Promise.all(months.map((m) => getOverrides(m).catch(() => [] as ActualOverride[])))
        : Promise.resolve(null),
      getPropolyAgentDeals({ email: user.email, agentKey: user.agentKey ?? null }).catch(
        () => null
      ),
      rexUserId ? getAgentListings(rexUserId).catch(() => null) : Promise.resolve(null),
      rexUserId && canFanOut
        ? Promise.all(months.map((m) => getAgentAppraisals(rexUserId, m).catch(() => null)))
        : Promise.resolve(null),
      // Listings INSTRUCTED in the window — one range query whatever the
      // window's length, and the only listings figure that means anything for
      // a past period. Also the denominator both conversions want.
      rexUserId && rangeStart && rangeEnd
        ? getAgentRampCounts(rexUserId, rangeStart, rangeEnd).catch(() => null)
        : Promise.resolve(null),
    ]);

  // The seed KPI rows describe July 2026 month-to-date and nothing else, so
  // they may only answer for a single-month July window. Handing them to a
  // range would report one month's figures as three.
  const snapshot = agentKey && single ? agentSeedStats(agentKey, months[0]) : nullFunnel();

  // ---- Funnel: field-by-field manual → snapshot base ----
  // The live layer is applied per field below, where each one can say which
  // window it actually answered for.
  const funnel = {} as FunnelStats;
  for (const field of FUNNEL_FIELDS) {
    const merged = resolveStat(
      null,
      overrideFor(overridesByMonth, agentKey, field),
      snapshot[field] ?? nullStat()
    );
    if (field === "liveListings") {
      if (merged.value != null || snapshot.liveListings) funnel.liveListings = merged;
      continue;
    }
    funnel[field as Exclude<FunnelField, "liveListings">] = merged;
  }
  // GCI is money — make sure it renders as £ even when manual (no display).
  if (funnel.gci && !funnel.gci.display && funnel.gci.value != null) {
    funnel.gci = { ...funnel.gci, display: formatGBP(funnel.gci.value) };
  }

  const basis: Record<string, FigureMeta> = {};
  /** Reason a period figure can't be answered at all, before we even ask. */
  const blocked = months.length === 0 ? NOTHING_YET : !canFanOut ? TOO_LONG : null;

  /* ------------------------------- as at today ------------------------------ */
  // Computed once, whatever the period, because the portfolio mix is honestly
  // a picture of right now and says so. NEVER fed to a period-labelled tile
  // unless the period IS the month we're standing in.

  const propolyActive = propolyDeals?.filter((a) => a.stage !== "unsuccessful") ?? null;
  const pipelineRows: PipelineDrillRow[] | null = propolyActive
    ? propolyActive.map((a) => ({
        property: [a.propertyName, a.locality].filter(Boolean).join(", "),
        // Propoly holds every applicant on the deal; the list only has room for
        // whose name is on it, so the lead tenant plus a count of the rest.
        tenant:
          a.tenants.length === 0
            ? "—"
            : a.tenants.length === 1
              ? a.tenants[0].name
              : `${a.tenants[0].name} +${a.tenants.length - 1}`,
        stage: a.status,
        moveIn: a.startDate,
        rent: a.offer,
      }))
    : null;
  const pipelineNow: StatValue | null = propolyActive
    ? {
        value: propolyActive.length,
        source: "live-propoly",
        note: "Live count of your deals in progression on Propoly — deal started through signing & move-in monies.",
        asOf: today(),
      }
    : null;

  // The agent's REX "current" listings. The count is what's on the market now
  // (let-agreed excluded, as it always has been), but the list shows the whole
  // current book so a partner can see the let-agreed ones too — both read off
  // this one array.
  const listingRows: ListingsDrillRow[] | null = liveListings
    ? liveListings.map((l) => ({
        address: l.address,
        rent: l.rent,
        letAgreed: l.letAgreed,
        status: l.letAgreed ? "Let agreed" : (l.publicationStatus ?? "On the market"),
        availableFrom: l.availableFrom,
      }))
    : null;
  const onMarketCount = listingRows ? listingRows.filter((l) => !l.letAgreed).length : null;
  const onMarketNow: StatValue | null =
    listingRows && onMarketCount != null
      ? {
          value: onMarketCount,
          source: "live-rex",
          note: `Live from REX — ${onMarketCount} on the market now${
            listingRows.length - onMarketCount > 0
              ? `, plus ${listingRows.length - onMarketCount} let agreed`
              : ""
          }.`,
          asOf: today(),
        }
      : null;

  /* ----------------------------- market appraisals --------------------------- */
  // Month-bound at the source (appraisal_date + same-month instructions), so a
  // range is genuinely the sum of its months — and the rows behind it are the
  // concatenation of the same months' rows.

  let appraisalRows: AppraisalsDrillRow[] | null = null;
  const appraisalSeries: (number | null)[] = months.map(() => null);
  if (appraisalsByMonth) {
    appraisalsByMonth.forEach((a, i) => {
      if (a) appraisalSeries[i] = a.combined ?? a.recorded;
    });
    // A part-answered range would be a short total nobody could spot. All or
    // nothing: if a month didn't come back, keep the figure "still gathering".
    if (appraisalsByMonth.every((a) => a != null)) {
      const rows = appraisalsByMonth.flatMap((a) => a!.rows);
      const value = appraisalsByMonth.reduce((t, a) => t + (a!.combined ?? a!.recorded), 0);
      const recorded = appraisalsByMonth.reduce((t, a) => t + a!.recorded, 0);
      // EVERY month, not some. getAgentAppraisals drops to recorded-only
      // whenever either listing-side call fails, which over a six-month fan-out
      // is routine — and `some` let one combined month put the business's
      // combined definition on a total that was partly recorded-only. A mixed
      // window is a third thing, and it names the months that fell back rather
      // than picking whichever claim happens to be flattering.
      const fellBack = months.filter((_, i) => appraisalsByMonth[i]!.combined == null);
      appraisalRows = rows
        .map((a) => ({ property: a.address, date: a.date, kind: a.kind }))
        .sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""));
      funnel.marketAppraisals = {
        value,
        source: "live-rex",
        note:
          fellBack.length === 0
            ? `Live from REX — ${recorded} recorded appraisal${recorded === 1 ? "" : "s"} in ${phrase}, plus that period's instructions with no appraisal against them. Same definition the business reports on.`
            : fellBack.length === appraisalsByMonth.length
              ? `Live count from REX Appraisals (agent_1_id, appraisal_date in ${phrase}).`
              : `Live from REX, but mixed: ${fellBack.map(monthLabel).join(", ")} counts recorded appraisals only (REX didn't answer the listings side for ${fellBack.length === 1 ? "that month" : "those months"}), while the rest also counts instructions with no appraisal against them. Not the business's combined definition across the whole window.`,
        asOf: today(),
      };
    }
  }
  basis.marketAppraisals = {
    basis: "period",
    label: `Booked in ${phrase}`,
    ...(funnel.marketAppraisals.value == null
      ? reason(blocked ?? (!rexUserId ? NO_REX_LINK : null))
      : {}),
  };

  /* --------------------------------- listings -------------------------------- */
  // Two legitimate definitions, and the tile has to say which it's using:
  //   the live month  → what's on the market NOW (what partners read it as)
  //   any other window → what was INSTRUCTED in that window (a flow, and the
  //                      figure Susan's dashboard reports)
  // The old code applied the first to every window, which is how "on the market
  // now" ended up sitting under an April heading.

  const instructedListings = instructed?.listings ?? null;
  const instructedStat: StatValue | null =
    instructedListings != null
      ? {
          value: instructedListings,
          source: "live-rex",
          note: `Live from REX — rental listings instructed in ${phrase} (non-draft, created in the period).`,
          asOf: today(),
        }
      : null;

  if (isLiveMonth && onMarketNow) {
    funnel.listings = instructedStat
      ? {
          ...onMarketNow,
          note: `${onMarketNow.note} ${instructedListings} instructed in ${phrase}.`,
        }
      : onMarketNow;
    basis.listings = { basis: "as-at-today", label: "On the market now" };
  } else if (instructedStat) {
    funnel.listings = instructedStat;
    basis.listings = { basis: "period", label: `Instructed in ${phrase}` };
  } else {
    // Neither answered. What's left is the manual/snapshot figure, which is a
    // month-to-date instruction count — say so rather than let it inherit
    // whichever label the live layer would have used.
    basis.listings = {
      basis: "period",
      label: `Instructed in ${phrase}`,
      ...(funnel.listings.value == null
        ? reason(blocked ?? (!rexUserId ? NO_REX_LINK : null))
        : {}),
    };
  }

  /* --------------------------------- pipeline -------------------------------- */
  // The honest "no". Propoly answers "which deals are in a progression stage
  // RIGHT NOW" — a deal that was in progression in April is complete or
  // cancelled today and simply isn't in those lists, and no snapshot of the
  // answer was ever stored. A past-month pipeline number would be invented.

  // The label may only turn as-at-today when the live read actually exists —
  // the same coupling listings has above. Propoly failing on the live month
  // used to leave the snapshot figure standing under "In progression now · as
  // at <today>": an 11 Jul count wearing today's date, which is the one thing
  // this route must never print.
  const pipelineReason =
    months.length === 0 ? NOTHING_YET : isLiveMonth ? NO_PROPOLY : PIPELINE_LIVE_ONLY;
  if (isLiveMonth && pipelineNow) {
    funnel.pipeline = pipelineNow;
    basis.pipeline = { basis: "as-at-today", label: "In progression now" };
  } else {
    funnel.pipeline = {
      value: null,
      source: "live-propoly",
      asOf: today(),
      note: pipelineReason.detail,
    };
    basis.pipeline = {
      basis: "as-at-today",
      label: "In progression now",
      ...reason(pipelineReason),
    };
  }

  /* --------------------------------- move-ins -------------------------------- */
  // PayProp knows which tenancies started in a month and the portfolio book
  // knows whose properties they are, so the two join on PayProp's id (and an
  // address key as the fallback — the move-ins report and the properties export
  // name the same property differently).
  //
  // CAVEAT, and it is stated in the note the badge shows: the book is TODAY's
  // property→partner map. A property that changed partner during the period is
  // attributed to whoever holds it now.
  const [moveInsByMonth, book] = await Promise.all([
    canFanOut
      ? Promise.all(months.map((m) => getMoveIns(m).catch(() => null)))
      : Promise.resolve(null),
    getAgentBook(user.name ?? "").catch(() => null),
  ]);

  let moveInRows: MoveInsDrillRow[] | null = null;
  const moveInSeries: (number | null)[] = months.map(() => null);
  if (moveInsByMonth && book && book.propertyNames.length) {
    const mineIds = new Set(book.propertyIds);
    const mineKeys = new Set(book.propertyKeys);
    const mine = (p: { propertyId?: string; propertyKey?: string }) =>
      (p.propertyId && mineIds.has(p.propertyId)) || (p.propertyKey && mineKeys.has(p.propertyKey));

    moveInsByMonth.forEach((m, i) => {
      if (m) moveInSeries[i] = m.properties.filter(mine).length;
    });
    if (moveInsByMonth.every((m) => m != null)) {
      const rows = moveInsByMonth.flatMap((m) => m!.properties.filter(mine));
      // Counted from the very array the drill-down lists, across the whole
      // window — the tile and the list it opens stay one answer.
      moveInRows = rows
        .map((r) => ({ property: r.property, tenant: r.tenant, rent: r.rent, from: r.from }))
        .sort((a, b) => (a.from ?? "").localeCompare(b.from ?? ""));
      funnel.moveIns = {
        value: rows.length,
        source: "live-payprop",
        note: `Live from PayProp — tenancies starting in ${phrase} on your properties${
          rows.length
            ? `, adding ${formatGBP(rows.reduce((t, r) => t + (r.rent ?? 0), 0))} of rent`
            : ""
        }. Attributed using today's property book, so a property that changed partner during the period counts to whoever holds it now.`,
        asOf: today(),
      };
    }
  }
  // An empty book is an ANSWER, not a gap: getAgentBook returns a zero-filled
  // book (not null) when nothing in PayProp matches the partner's name, so this
  // never resolves by waiting. Said on the first response, because the tile's
  // alternative is animating "Finding data…" forever at a question nobody is
  // working on. book == null IS still gathering, and stays that way.
  const emptyBook = book != null && book.propertyNames.length === 0;
  basis.moveIns = {
    basis: "period",
    label: `Started in ${phrase}`,
    ...(funnel.moveIns.value == null
      ? reason(blocked ?? (emptyBook ? NO_PAYPROP_BOOK : null))
      : {}),
  };

  /* ------------------------ figures the seed alone holds ---------------------- */
  // Viewings, applications and GCI have no live per-partner source at all —
  // they exist only in the July KPI capture. Off that month they're not "zero"
  // and not "loading"; they're not tracked, and they say so.
  for (const field of ["viewings", "applications", "gci"] as const) {
    const stat = funnel[field];
    if (!stat) continue;
    basis[field] = {
      basis: "period",
      label: phrase,
      ...(stat.value == null ? reason(months.length === 0 ? NOTHING_YET : SEED_ONLY) : {}),
    };
  }

  /* -------------------------------- conversions ------------------------------ */
  // Rebuilt on MATCHED inputs: same window top and bottom. Both rates divide by
  // listings INSTRUCTED in the period, never by what happens to be on the market
  // today — that mixed a flow numerator with a stock denominator and made the
  // rate move when a property let, without anything having converted.
  // For a range: sum the numerator and the denominator, then divide. Averaging
  // monthly rates would weight a quiet month the same as a busy one.
  const mas = funnel.marketAppraisals;
  const moveIns = funnel.moveIns;
  const conversionBasis: Record<string, FigureMeta> = {};

  const metaLeads =
    meta.configured && "snapshot" in meta && meta.snapshot ? meta.snapshot.leads : null;
  const metaLeadsStat: StatValue | null =
    metaLeads != null ? { value: metaLeads, source: "live-meta", asOf: today() } : null;

  const leadToMa: StatValue =
    isLiveMonth && metaLeadsStat
      ? conversionStat(
          pct(mas.value, metaLeadsStat.value),
          [mas, metaLeadsStat],
          `${mas.value ?? "—"} MAs from ${metaLeads} Meta leads (leads are a rolling 30 days, not a calendar month)`
        )
      : {
          value: null,
          source: "derived",
          note: isLiveMonth
            ? "Needs your live Meta leads count — ask the admin to link your ad campaign to see this."
            : "Meta reports leads over a rolling 30-day window, so there's no lead count for a past month to divide by.",
        };
  conversionBasis.leadToMa = {
    basis: isLiveMonth ? "as-at-today" : "period",
    // Even when it answers, the denominator is a rolling 30 days against a
    // calendar-month numerator. Say so on the gauge rather than in a tooltip.
    label: "Leads: rolling 30 days",
    ...(leadToMa.value == null
      ? reason(
          isLiveMonth
            ? {
                short: "Needs your Meta campaign linked.",
                detail:
                  "Lead → MA divides your market appraisals by the leads your Meta campaign brought in. Ask the admin to link your campaign and it fills in.",
              }
            : {
                short: "Rolling 30 days only.",
                detail:
                  "Meta reports leads over a rolling 30-day window, so there's no per-month lead count to divide a past month's appraisals by. Making this period-aware means asking Meta Insights for a time_range instead of a date_preset — a change to lib/meta.ts.",
              }
        )
      : {}),
  };

  const conversions: ConversionStats = {
    leadToMa,
    maToListing: conversionStat(
      pct(instructedStat?.value ?? null, mas.value),
      [instructedStat ?? nullStat(), mas],
      `${instructedStat?.value ?? "—"} listings instructed from ${mas.value ?? "—"} market appraisals in ${phrase}`
    ),
    listingToMoveIn: conversionStat(
      pct(moveIns.value, instructedStat?.value ?? null),
      [moveIns, instructedStat ?? nullStat()],
      `${moveIns.value ?? "—"} move-ins from ${instructedStat?.value ?? "—"} listings instructed in ${phrase}`
    ),
  };
  // A rate is only as answerable as its inputs, so it repeats whichever input's
  // reason stopped it. No reason at all means an input is still gathering —
  // which the gauge shows as an empty ring, not as a nought.
  const inherit = (m: FigureMeta): Reason | null =>
    m.unavailable ? { short: m.unavailable, detail: m.detail ?? m.unavailable } : null;

  conversionBasis.maToListing = {
    basis: "period",
    label: phrase,
    ...(conversions.maToListing.value == null
      ? reason(blocked ?? inherit(basis.marketAppraisals))
      : {}),
  };
  conversionBasis.listingToMoveIn = {
    basis: "period",
    label: phrase,
    ...(conversions.listingToMoveIn.value == null
      ? reason(blocked ?? inherit(basis.moveIns))
      : {}),
  };

  if (funnel.gci?.value != null && moveIns.value != null && moveIns.value > 0) {
    const perMoveIn = funnel.gci.value / moveIns.value;
    const allSnapshot = funnel.gci.source === "snapshot" && moveIns.source === "snapshot";
    conversions.gciPerMoveIn = {
      value: perMoveIn,
      display: formatGBP(perMoveIn),
      source: allSnapshot ? "snapshot" : "derived",
      note: `${formatGBP(funnel.gci.value)} GCI ÷ ${moveIns.value} move-ins, ${phrase}`,
      asOf: allSnapshot ? SNAPSHOT_DATE : today(),
    };
  }
  conversionBasis.gciPerMoveIn = {
    basis: "period",
    label: phrase,
    ...(conversions.gciPerMoveIn?.value == null
      ? reason(
          months.length === 0
            ? NOTHING_YET
            : funnel.gci?.value == null
              ? SEED_ONLY
              : {
                  short: "No move-ins to divide by.",
                  detail: `Nothing started on your properties in ${phrase}, so there's no per-move-in figure to work out.`,
                }
        )
      : {}),
  };

  // ---- Portfolio (managed properties + monthly rent roll) ----
  // Live REX (leased listings) → snapshot PayProp figures. As-at-today by
  // nature: both systems export current state and neither keeps a history, so
  // "your portfolio as it stood in April" isn't reconstructable. It carries the
  // date it was read, never the selected period.
  const snapPortfolio = agentKey ? agentPortfolio(agentKey) : null;
  const portfolio = {
    managed:
      livePortfolio != null
        ? ({
            value: livePortfolio.managed,
            source: "live-rex",
            note: "Live count of your managed (let) properties in REX, as at today.",
            asOf: today(),
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
            note: "Live monthly rent roll (sum of rent across your let properties in REX), as at today.",
            asOf: today(),
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
    // What the response actually covers: `months` is what was counted, and
    // `future` is what was asked for but hasn't happened. The dashboard labels
    // the period with the first and explains the second.
    period: {
      months,
      requested,
      future,
      liveMonth,
      isLiveMonth,
      label: phrase,
      maxMonths: MAX_FANOUT_MONTHS,
    },
    agentKey,
    funnel,
    // What each funnel figure is an answer to, and why it hasn't got one.
    funnelBasis: basis,
    // Per-month values across the period, aligned to period.months — the flow
    // figures' own sparklines. null = that month didn't answer.
    funnelSeries: {
      marketAppraisals: appraisalSeries,
      moveIns: moveInSeries,
    },
    // Drill-down rows. Only the stages joined to a real source appear here;
    // the rest stay null so the dashboard can label them honestly.
    funnelRows: {
      marketAppraisals: appraisalRows,
      listings: isLiveMonth ? listingRows : null,
      moveIns: moveInRows,
      pipeline: isLiveMonth ? pipelineRows : null,
    } satisfies FunnelRows,
    conversions,
    conversionBasis,
    portfolio,
    // Full snapshot mix (managed / let-only / RLP / avg rent) for the donut.
    portfolioDetail: snapPortfolio,
    // Read live, right now, whatever period is selected — the portfolio mix is
    // honestly a picture of today and is labelled as one. Kept apart from the
    // funnel so a period-labelled tile can never quietly borrow it.
    asAtToday: {
      asOf: today(),
      onMarket: onMarketNow,
      pipeline: pipelineNow,
    },
    // Seed rows, July 2026 only — agentMoveIns answers for no other month, so
    // the "My move-ins" list can't show July's tenancies under June's heading.
    moveIns: agentKey && single ? agentMoveIns(agentKey, months[0]) : [],
    // Forward-looking by nature (July + Aug–Sep seed rows): not a period figure
    // at all, so it isn't filtered by one.
    pipeline: agentKey ? agentPipeline(agentKey) : [],
    compliance: agentKey ? agentCompliance(agentKey) : null,
    netIncomeYtd: agentKey ? agentNetIncomeYtd(agentKey) : null,
  });
}
