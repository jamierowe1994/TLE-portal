"use client";

import { useEffect, useMemo, useState } from "react";
import StatCard from "@/components/StatCard";
import SourceBadge from "@/components/SourceBadge";
import FindingData from "@/components/FindingData";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import Collapsible from "@/components/Collapsible";
import CollapsePanel, { PANEL_STAGGER } from "@/components/CollapsePanel";
import FunnelDrilldown, { DrilldownPending } from "@/components/FunnelDrilldown";
import Sparkline from "@/components/charts/Sparkline";
import Gauge from "@/components/charts/Gauge";
import DoodleIcon from "@/components/DoodleIcon";
import Loader from "@/components/Loader";
import ForecastBuilder, { type SavedForecast } from "@/components/ForecastBuilder";
import PeriodPicker, { type ResolvedPeriod, resolvePreset } from "@/components/PeriodPicker";
import { formatDate, formatDateShort, formatGBP, formatNum, monthLabel } from "@/lib/format";
import { LIVE_START, liveMonth } from "@/lib/roster";
import type {
  AppraisalsDrillRow,
  ConversionStats,
  FunnelRows,
  FunnelStats,
  ListingsDrillRow,
  MoveInsDrillRow,
  PipelineDrillRow,
  StatValue,
} from "@/lib/types";
import type {
  ComplianceAgentRow,
  MoveInRow,
  PartnerNetIncomeRow,
  PipelineRow,
  PortfolioRow,
} from "@/lib/seed-types";

// My Dashboard — the signed-in agent's year at a glance. Decluttered around
// what agents actually asked for: earnings YTD (hero), the basics, a live
// forecast graph they can drag, conversion rates, and detail tucked away.
//
// THE PERIOD RULE, which everything below follows: a figure never appears under
// a heading it isn't an answer to. The picker resolves to a set of months and
// the page reads in two zones —
//   period zone      the flow figures for those months (earnings, appraisals,
//                    move-ins, listings instructed) and every heading that
//                    carries the period label;
//   as-at-today zone the stocks that only exist right now (portfolio mix,
//                    what's on the market, deals in progression), each stamped
//                    with the date it was read and NEVER the period label.
// Where a figure can't be computed for the selected period, the API says why
// and the tile prints the reason instead of a number. Three states have to stay
// telling apart at a glance: still gathering (FindingData, animated), a real
// zero, and not-computable-for-this-period (muted, with a reason).

type Rowify<T> = T & Record<string, unknown>;

/** What a figure is an answer to — mirrors FigureMeta in /api/my/stats. */
interface FigureMeta {
  basis: "period" | "as-at-today";
  label: string;
  /** Short reason, shown where the number would be. */
  unavailable?: string;
  /** The rest of it, for the panel that opens underneath. */
  detail?: string;
}

interface StatsResponse {
  month: string;
  /** What the response actually covers, after the API drops future months. */
  period: {
    months: string[];
    requested: string[];
    future: string[];
    /** Real months, but before the portal measured anything. Not the future. */
    preLive: string[];
    liveMonth: string;
    liveStart: string;
    isLiveMonth: boolean;
    label: string;
    maxMonths: number;
  };
  agentKey: string | null;
  funnel: FunnelStats;
  funnelBasis: Record<string, FigureMeta | undefined>;
  /** Per-month values across period.months — the flow figures' sparklines. */
  funnelSeries: { marketAppraisals: (number | null)[]; moveIns: (number | null)[] };
  /** Rows behind the funnel counts — a field is null until it has a source. */
  funnelRows?: FunnelRows;
  conversions: ConversionStats;
  conversionBasis: Record<string, FigureMeta | undefined>;
  portfolio: { managed: StatValue; rentRoll: StatValue };
  portfolioDetail: PortfolioRow | null;
  /** Live stocks, read now — the only things the mix box is allowed to use. */
  asAtToday: { asOf: string; onMarket: StatValue | null; pipeline: StatValue | null };
  moveIns: MoveInRow[];
  pipeline: PipelineRow[];
  compliance: ComplianceAgentRow | null;
  /** True when `compliance` was rolled up live from REX, not the July capture. */
  complianceLive?: boolean;
  /** Properties REX couldn't fully read — excluded, never assumed compliant. */
  complianceUnchecked?: number;
  netIncomeYtd: PartnerNetIncomeRow | null;
}

interface EarningsResponse {
  connected: boolean;
  byMonth?: Array<{
    month: string;
    /** `earned` is VAT-INCLUSIVE from PayProp; `earnedNet` is what the accounts
     *  sheet reports and what this page shows. */
    earnings: { earned: number; earnedNet: number; matched: boolean } | null;
  }>;
  period?: {
    months: string[];
    earned: number | null;
    matched: boolean;
    complete: boolean;
    missing: string[];
    byCategory: Array<{ category: string; amount: number }>;
    unavailable?: string;
  };
  refreshing?: boolean;
}

// Standard management fee assumption for the estimated-income figure. TLE bills
// ~9% of rent (inc RLP); the agent's final share is confirmed with head office.
const MGMT_FEE_RATE = 0.09;

interface ForecastResponse {
  month: string;
  forecast: unknown;
  history?: Array<{ month: string; gciTarget: number | null; portfolioTarget: number | null }>;
  actuals: Record<string, number | null>;
}

/* --------------------------------- helpers -------------------------------- */

const YEAR = "2026";
// The month every current-state figure answers for.
//
// This used to be a hand-typed "2026-07" and there were FOUR copies of it that
// had to agree. They didn't: the period picker read the clock while this and
// the stats API stayed pinned to July, so on 1 August the page asked for a
// month the API classed as the future — tiles emptied, and where the snapshot
// stood in behind them, July's figures appeared under an August heading.
// Now one exported constant, off the clock, floored at LIVE_START.
const ANCHOR = liveMonth();
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_KEYS = MONTH_LABELS.map((_, i) => `${YEAR}-${String(i + 1).padStart(2, "0")}`);
const SNAP = "2026-07-11";
const monthIdx = (m: string) => Number(m.slice(5, 7)) - 1;

/**
 * "June 2026" / "May–Jul 2026" — how a heading names the window it covers.
 * A gap in the middle is listed out rather than spanned: "May, Jul" is not
 * "May–Jul", and the difference is a month of somebody's figures.
 */
function phraseOf(months: string[]): string {
  if (months.length === 0) return "—";
  if (months.length === 1) return monthLabel(months[0]);
  const idx = months.map(monthIdx);
  const last = months[months.length - 1];
  const contiguous = idx.every((n, i) => i === 0 || n === idx[i - 1] + 1);
  if (!contiguous) return `${idx.map((n) => MONTH_LABELS[n]).join(", ")} ${last.slice(0, 4)}`;
  return `${MONTH_LABELS[idx[0]]}–${MONTH_LABELS[monthIdx(last)]} ${last.slice(0, 4)}`;
}

function snapStat(value: number | null, note: string, display?: string): StatValue {
  return { value, display, source: "snapshot", asOf: SNAP, note };
}

/**
 * How a figure should read. The three states are deliberately distinct:
 * "value" is the answer (including a real zero), "pending" means a source is
 * still gathering and we ask again, "unavailable" means it cannot be computed
 * for this period at all and the reason is shown in place of the number.
 */
type FigureState = { kind: "value" } | { kind: "pending" } | { kind: "unavailable"; reason: string };

function figureState(
  stat: StatValue | undefined,
  meta?: FigureMeta,
  /** True once the bounded retry below is spent — see GAVE_UP. */
  gaveUp = false
): FigureState {
  if (meta?.unavailable) return { kind: "unavailable", reason: meta.unavailable };
  if (!stat || (stat.value == null && stat.display == null))
    return gaveUp ? { kind: "unavailable", reason: GAVE_UP } : { kind: "pending" };
  return { kind: "value" };
}

// The four "this month" figures an agent can open out to see the records
// behind them — REX for appraisals and listings, Propoly for the pipeline,
// PayProp for move-ins.
type DrillKey = "marketAppraisals" | "listings" | "moveIns" | "pipeline";

// PayProp and REX gather in the background, so a figure with no value and no
// reason is worth asking for again — bounded, because a partner whose REX
// profile is unlinked would otherwise poll for their whole session.
const STATS_RETRY_MS = 8000;
const STATS_RETRIES = 6;
/**
 * What a still-empty figure says once those retries are spent. "Finding data…"
 * animating away is a claim that something is still working on the question;
 * after the last retry nothing is, and a promise the page can't keep is worse
 * than an admission. Stated as confidently as it is true: we don't know, and
 * we've stopped asking.
 */
const GAVE_UP = "Couldn't reach this source. Reload to try again.";

/** How the "can't be computed" reason reads in place of a number. */
function ReasonLine({ reason }: { reason: string }) {
  return <p className="mt-1 max-w-[24ch] text-[11px] leading-snug text-muted">{reason}</p>;
}

/**
 * The drill-down for a figure that has no answer for this period. Deliberately
 * the same dashed, empty-handed frame as DrilldownPending — but where that says
 * "the records aren't wired up yet", this says why the question can't be
 * answered at all, in full.
 */
function DrilldownUnavailable({ meta }: { meta: FigureMeta }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-5">
      <p className="text-[13px] text-ink">{meta.unavailable}</p>
      {meta.detail && meta.detail !== meta.unavailable ? (
        <p className="mt-1.5 text-[12px] text-muted">{meta.detail}</p>
      ) : null}
    </div>
  );
}

// Entrance choreography — each piece lands on its own beat so the dashboard
// builds itself as you arrive. Delays are relative to this content mounting
// (which is after the greeting has already had its moment).
const enterAt = (ms: number) =>
  ({ "--enter-delay": `${ms}ms` }) as React.CSSProperties;

/* ---------------------------------- page ---------------------------------- */

export default function MyDashboardPage() {
  const [period, setPeriod] = useState<ResolvedPeriod>(() => resolvePreset("this-month"));
  // Live commission from PayProp for the selected months — the snapshot's
  // stand-in until it lands, since the walk runs in the background.
  const [liveEarnings, setLiveEarnings] = useState<EarningsResponse | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [actuals, setActuals] = useState<Record<string, number | null>>({});
  const [forecastHistory, setForecastHistory] = useState<Record<string, SavedForecast>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // The bounded retry has run out with figures still empty. A tile that has no
  // number, no reason and nothing left fetching for it must stop saying it's
  // still looking — see GAVE_UP.
  const [gaveUp, setGaveUp] = useState(false);
  // The same admission for the earnings hero, which polls on its own timer. It
  // is terminal on the FIRST response for the two answers that will never
  // change — PayProp unconfigured, and a partner PayProp holds no beneficiary
  // for — because neither is a question anything is still working on.
  const [earningsGaveUp, setEarningsGaveUp] = useState(false);
  // Which of the period's figures is opened out to show its records. One at a
  // time — the panels share the space under the row. Declared up here with the
  // other hooks, never below a conditional return.
  const [drill, setDrill] = useState<DrillKey | null>(null);

  // The selection, as the API wants it. Future months go over as asked and the
  // API drops them, so the response can say which ones haven't happened rather
  // than the page quietly counting them as nothing.
  const monthsParam = period.months.join(",");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;
    setLoading(true);
    setError(null);
    setGaveUp(false);

    const ask = (first: boolean) => {
      // The funnel and basics are period figures; the forecast GET returns the
      // agent's whole forecast history + monthly actuals (both month-agnostic),
      // so it's only worth fetching on the first pass of a period.
      const statsReq = fetch(`/api/my/stats?months=${monthsParam}`, { cache: "no-store" }).then(
        async (res) => {
          if (!res.ok) throw new Error("Couldn't load your stats.");
          return (await res.json()) as StatsResponse;
        }
      );

      const forecastReq = first
        ? fetch(`/api/my/forecast?month=${ANCHOR}`, { cache: "no-store" })
            .then(async (res) => (res.ok ? ((await res.json()) as ForecastResponse) : null))
            .catch(() => null)
        : Promise.resolve(null);

      Promise.all([statsReq, forecastReq])
        .then(([s, f]) => {
          if (cancelled) return;
          setStats(s);
          if (f) {
            setActuals(f.actuals ?? {});
            const hist: Record<string, SavedForecast> = {};
            for (const row of f.history ?? []) {
              hist[row.month] = {
                gciTarget: row.gciTarget ?? null,
                portfolioTarget: row.portfolioTarget ?? null,
              };
            }
            setForecastHistory(hist);
          }
          // Anything still gathering gets one more ask, a few times over — a
          // partner who loads while PayProp is cold used to keep the snapshot
          // figures for the rest of their session.
          const stillGathering =
            (["marketAppraisals", "listings", "moveIns", "pipeline"] as const).some(
              (f2) => figureState(s.funnel[f2], s.funnelBasis?.[f2]).kind === "pending"
            ) ||
            // The portfolio mix has its own empty figures (rent roll, est.
            // fees), and both come off these two. They were outside this test,
            // so nothing retried them AND gaveUp was never reached for an
            // unlinked partner — whose funnel comes back unavailable, not
            // pending. Two spinners animated for the rest of the session.
            (["managed", "rentRoll"] as const).some(
              (p) => figureState(s.portfolio?.[p]).kind === "pending"
            );
          if (stillGathering && tries++ < STATS_RETRIES) {
            timer = setTimeout(() => ask(false), STATS_RETRY_MS);
          } else if (stillGathering) {
            // Out of retries and still empty. Nothing is coming, so whatever is
            // left pending says it couldn't be reached rather than going on
            // animating at a question no longer being asked.
            setGaveUp(true);
          }
        })
        .catch((e) => {
          if (cancelled || !first) return; // a failed retry keeps what we have
          setError(e instanceof Error ? e.message : "Something went wrong.");
        })
        .finally(() => {
          if (!cancelled && first) setLoading(false);
        });
    };

    ask(true);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [monthsParam, reloadKey]);

  // PayProp gathers in the background, so ask again shortly after the first
  // miss rather than leaving the card on the snapshot for the whole session.
  // Re-runs on every period change: getAgentEarnings is month-parameterised, so
  // past months are a real answer rather than this month's figure relabelled.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;
    setLiveEarnings(null);
    setEarningsGaveUp(false);
    const ask = () => {
      fetch(`/api/my/earnings?months=${monthsParam}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: EarningsResponse) => {
          if (cancelled) return;
          setLiveEarnings(d);
          // Only "a month hasn't come back yet" is worth waiting on. A partner
          // PayProp holds no beneficiary for has ANSWERED — unmatched, but
          // answered — and polling that for three minutes helps nobody.
          const worthAsking = (d.period?.missing?.length ?? 0) > 0 && !d.period?.unavailable;
          if (worthAsking && tries++ < 40) {
            timer = setTimeout(ask, 5000);
          } else {
            // Nothing further is coming for this figure — either it answered,
            // or it answered that it can't. Whichever, the hero stops claiming
            // a walk is still running.
            setEarningsGaveUp(true);
          }
        })
        .catch(() => {
          if (!cancelled) setEarningsGaveUp(true);
        });
    };
    ask();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [monthsParam]);

  /* ------------------------------ derived data ------------------------------ */

  const actualsArr = useMemo(() => MONTH_KEYS.map((k) => actuals[k] ?? null), [actuals]);

  // Forecast-builder inputs: avg estimated management fee per managed property.
  const managed = stats?.portfolio.managed.value ?? 0;
  const rentRoll = stats?.portfolio.rentRoll.value ?? 0;
  const avgFeePerProperty = managed > 0 ? (rentRoll * MGMT_FEE_RATE) / managed : 0;

  // What the page is actually reporting on. The API is the authority once it
  // has answered (it drops months that haven't happened); before that we clamp
  // the same way so the heading never claims a month it can't have.
  const periodMonths = stats?.period.months ?? period.months.filter((m) => m <= ANCHOR);
  const futureMonths = stats?.period.future ?? period.months.filter((m) => m > ANCHOR);
  // Everything asked for is still ahead of us. Not "no data" — hasn't happened.
  const nothingYet = periodMonths.length === 0;
  const phrase = nothingYet ? phraseOf(period.months) : phraseOf(periodMonths);
  // "Last 3 months · May–Jul 2026" — the preset's name plus the months it came
  // out as, so nobody has to work out which three.
  const periodHeading = period.label === phrase ? phrase : `${period.label} · ${phrase}`;
  // The selected period IS the single month we're standing in — the one window
  // a current-state figure may answer for. Was called isLiveMonthPeriod back
  // when that month and the snapshot's month were the same thing; they are not
  // any more, and the old name is exactly the confusion to avoid.
  const isLiveMonthPeriod = periodMonths.length === 1 && periodMonths[0] === ANCHOR;
  // Asked for real months that pre-date the portal measuring anything. Distinct
  // from `nothingYet`: both have no figures, but one hasn't happened and the
  // other was only ever counted by hand.
  const preLiveMonths = stats?.period.preLive ?? [];
  const beforeWeStarted = periodMonths.length === 0 && preLiveMonths.length > 0;
  const asAtLabel = formatDateShort(stats?.asAtToday.asOf) || "today";

  /* -------------------------------- earnings -------------------------------- */
  // Two sources can answer this: PayProp (what was actually paid to them, per
  // month, for any month) and the snapshot's monthly actuals. Never both in one
  // figure — the total, the sparkline, the average and the best month all come
  // off ONE array, so a live total can't sit over a snapshot trend.
  const liveByMonth = new Map(
    (liveEarnings?.byMonth ?? []).map((r) => [
      r.month,
      r.earnings?.matched ? r.earnings.earnedNet : null,
    ])
  );
  const useLive = liveEarnings?.period?.complete === true;
  const earningsSeries = periodMonths.map((m) =>
    useLive ? (liveByMonth.get(m) ?? null) : (actuals[m] ?? null)
  );
  const coveredIdx = earningsSeries
    .map((v, i) => (v == null ? -1 : i))
    .filter((i) => i >= 0);
  const periodEarnings = coveredIdx.length
    ? coveredIdx.reduce((t, i) => t + (earningsSeries[i] as number), 0)
    : null;
  // Divides the SAME array it summed — it used to divide a live total by a
  // count of snapshot months, which only stayed harmless because July has no
  // snapshot actual.
  const avgPerMonth = coveredIdx.length
    ? Math.round((periodEarnings as number) / coveredIdx.length)
    : null;
  // Searched WITHIN the selected period. Searching the whole year could label
  // the best month of May–Jul as February, if February happened to match.
  const bestIdx = coveredIdx.reduce(
    (best, i) =>
      best < 0 || (earningsSeries[i] as number) > (earningsSeries[best] as number) ? i : best,
    -1
  );
  const bestVal = bestIdx >= 0 ? (earningsSeries[bestIdx] as number) : null;
  const bestLabel = bestIdx >= 0 ? MONTH_LABELS[monthIdx(periodMonths[bestIdx])] : null;
  const missingMonths = periodMonths.filter((_, i) => earningsSeries[i] == null);
  const liveMonthPending = missingMonths.length === 1 && missingMonths[0] === ANCHOR;
  // Why there's no number, for when the poll has stopped and there still isn't
  // one. "Unmatched" is only said when PayProp answered for every month it was
  // asked — otherwise the months simply didn't come back, which is a different
  // thing and mustn't be reported as a broken PayProp record.
  const earningsReason =
    liveEarnings?.connected === false
      ? "PayProp isn't connected here, and there's no snapshot figure for this period."
      : (liveEarnings?.period?.unavailable ??
        (liveEarnings?.period && liveEarnings.period.missing.length === 0 && !liveEarnings.period.matched
          ? "PayProp has no beneficiary matching your details, so your commission can't be looked up — ask head office to check your PayProp record."
          : GAVE_UP));

  /* --------------------------------- tables --------------------------------- */

  // Drill-down rows. Every one of these is counted by the API from the very
  // array it hands over, so the figure on a tile and the list underneath it
  // can't drift apart. null means the source didn't answer — a different thing
  // from "you had none", and the panels say so.
  const moveInDrillRows = stats?.funnelRows?.moveIns ?? null;
  const listingDrillRows = stats?.funnelRows?.listings ?? null;
  const pipelineDrillRows = stats?.funnelRows?.pipeline ?? null;
  const appraisalDrillRows = stats?.funnelRows?.marketAppraisals ?? null;
  // PayProp's rows when we have them; otherwise the seed list, but ONLY for the
  // month the seed actually describes. Off that month there is no fallback —
  // July's tenancies under June's heading is the exact mistake this page is
  // being fixed for.
  const moveInsStat: StatValue =
    moveInDrillRows || !isLiveMonthPeriod
      ? (stats?.funnel.moveIns ?? { value: null, source: "live-payprop" })
      : snapStat(
          stats?.moveIns.length ?? 0,
          "From your move-in list",
          formatNum(stats?.moveIns.length ?? 0)
        );

  const moveInDrillColumns: DataTableColumn<Rowify<MoveInsDrillRow>>[] = [
    { key: "property", label: "Property" },
    { key: "tenant", label: "Tenant" },
    { key: "from", label: "Starts" },
    { key: "rent", label: "Rent pcm", align: "right", render: (r) => formatGBP(r.rent) },
  ];

  const listingDrillColumns: DataTableColumn<Rowify<ListingsDrillRow>>[] = [
    { key: "address", label: "Property" },
    { key: "status", label: "Status" },
    { key: "availableFrom", label: "Available", render: (r) => formatDate(r.availableFrom) },
    {
      key: "rent",
      label: "Rent pcm",
      align: "right",
      render: (r) => (r.rent == null ? "—" : formatGBP(r.rent)),
    },
  ];

  const pipelineDrillColumns: DataTableColumn<Rowify<PipelineDrillRow>>[] = [
    { key: "property", label: "Property" },
    { key: "tenant", label: "Tenant" },
    { key: "stage", label: "Stage" },
    { key: "moveIn", label: "Expected move-in", render: (r) => formatDate(r.moveIn) },
    {
      key: "rent",
      label: "Rent pcm",
      align: "right",
      render: (r) => (r.rent == null ? "—" : formatGBP(r.rent)),
    },
  ];

  const appraisalDrillColumns: DataTableColumn<Rowify<AppraisalsDrillRow>>[] = [
    { key: "property", label: "Property" },
    { key: "date", label: "Date", render: (r) => formatDate(r.date) },
    {
      // Half these rows are instructions with no appraisal recorded against
      // them — say which is which rather than let a partner wonder why a
      // property they never appraised is on their list.
      key: "kind",
      label: "Recorded as",
      render: (r) =>
        r.kind === "appraisal" ? (
          "Appraisal in REX"
        ) : (
          <span className="text-muted">Instruction, no appraisal logged</span>
        ),
    },
  ];

  const moveInColumns: DataTableColumn<Rowify<MoveInRow>>[] = [
    { key: "property", label: "Property" },
    { key: "moveInDate", label: "Move-in" },
    { key: "letType", label: "Let type" },
    { key: "serviceLevel", label: "Service level" },
    { key: "rentPcm", label: "Rent pcm", align: "right", render: (r) => formatGBP(r.rentPcm) },
    { key: "setupFee", label: "Setup fee", align: "right", render: (r) => formatGBP(r.setupFee) },
    { key: "twelveMonthValue", label: "12m value", align: "right", render: (r) => formatGBP(r.twelveMonthValue) },
  ];

  /** PayProp's live tenancy starts. Fewer columns than the seed table because
   *  fewer things are actually known — no invented setup fee or 12m value. */
  const liveMoveInColumns: DataTableColumn<Rowify<MoveInsDrillRow>>[] = [
    { key: "property", label: "Property" },
    { key: "tenant", label: "Tenant" },
    { key: "from", label: "Move-in", render: (r) => formatDateShort(r.from) || "—" },
    { key: "rent", label: "Rent pcm", align: "right", render: (r) => formatGBP(r.rent) },
  ];

  /** Propoly's live deals in progression. */
  const livePipelineColumns: DataTableColumn<Rowify<PipelineDrillRow>>[] = [
    { key: "property", label: "Property" },
    { key: "tenant", label: "Tenant" },
    { key: "stage", label: "Stage" },
    { key: "moveIn", label: "Move-in", render: (r) => formatDateShort(r.moveIn) || "—" },
    { key: "rent", label: "Rent pcm", align: "right", render: (r) => formatGBP(r.rent) },
  ];

  const pipelineColumns: DataTableColumn<Rowify<PipelineRow>>[] = [
    { key: "property", label: "Property" },
    { key: "expectedMoveIn", label: "Expected move-in" },
    { key: "status", label: "Status" },
    { key: "serviceLevel", label: "Service level" },
    { key: "rentPcm", label: "Rent pcm", align: "right", render: (r) => formatGBP(r.rentPcm) },
  ];

  /* --------------------------------- render --------------------------------- */

  const c = stats?.conversions;
  const cb = stats?.conversionBasis;
  const fb = stats?.funnelBasis;
  // Your earnings ÷ your move-ins, both over the selected months. The two live
  // in different routes, so this is the one place they meet — and it only shows
  // when PayProp answered for EVERY month, so the top and bottom cover the same
  // window. Kept distinct from GCI per move-in, which is a different figure
  // (the business's commission, from the July KPI capture) under its own name.
  const earningsPerMoveIn =
    useLive && periodEarnings != null && (stats?.funnel.moveIns.value ?? 0) > 0
      ? periodEarnings / (stats!.funnel.moveIns.value as number)
      : null;

  return (
    // outline-cards: the dashboard experiment — boxes as outlines on the grey
    // rather than filled white (globals.css).
    <div className="outline-cards space-y-5">
      {/* Period selector — drives everything in the period zone below.
          Slides in from behind the nav rail. */}
      <div
        className="enter enter-left flex flex-wrap items-center gap-3"
        style={enterAt(800)}
      >
        <div>
          <h1 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
            Your {periodMonths.length === 1 ? "month" : "period"} · {phrase}
          </h1>
          {/* Two different reasons a month in the selection has no figures, and
              they must not be worded the same. July hasn't "not happened yet";
              the portal simply wasn't measuring then. */}
          {futureMonths.length ? (
            <p className="mt-1 text-[12px] text-muted">
              {phraseOf(futureMonths)} hasn&apos;t happened yet
              {nothingYet ? "." : ` — showing ${phrase}.`}
            </p>
          ) : null}
          {preLiveMonths.length ? (
            <p className="mt-1 text-[12px] text-muted">
              {phraseOf(preLiveMonths)} pre-dates the portal&apos;s own figures, which start in{" "}
              {monthLabel(LIVE_START)}
              {beforeWeStarted ? "." : ` — showing ${phrase}.`}
            </p>
          ) : null}
        </div>
        <div className="ml-auto">
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
      </div>

      {!loading && stats && !stats.agentKey ? (
        <div className="card flex items-center gap-3 p-4 text-[13px]">
          <DoodleIcon name="bell" size={18} className="shrink-0 text-accent" />
          <p>
            <span className="font-semibold accent-text">Your stats profile isn&apos;t linked yet.</span>{" "}
            <span className="text-ink">
              Ask the admin to link your account to your agent profile — your earnings, funnel and
              pipeline will appear here as soon as that&apos;s done.
            </span>
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="card p-6 text-center text-sm text-muted">
          {error}{" "}
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="font-medium accent-text underline-offset-2 hover:underline"
          >
            Try again
          </button>
        </div>
      ) : null}

      {loading ? <Loader label="Pulling your numbers together…" /> : null}

      {!loading && stats ? (
        <>
          {/* ---- HERO: earnings (period zone) + portfolio mix (as at today)
               share ONE outlined box, split by a centre line that stops short
               of the edges ---- */}
          <section className="enter enter-up card grid lg:grid-cols-[1fr_1.3fr]" style={enterAt(900)}>
            <div className="flex h-full flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                  <DoodleIcon name="wallet" size={16} className="text-accent" />
                  Earnings · {phrase}
                </div>
                {useLive ? (
                  <SourceBadge
                    source="live-payprop"
                    note={`Your commission for ${phrase}, live from PayProp — management and set-up fees paid to you.`}
                  />
                ) : (
                  <SourceBadge source="snapshot" asOf={SNAP} note="Partner net income (exc VAT) from the TLE Business Dashboard snapshot." />
                )}
              </div>
              <div className="my-auto flex items-center gap-5 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/illustrations/piggy.png"
                  alt=""
                  aria-hidden
                  className="w-[130px] shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
                    <div
                      className={`stat-value text-[17px] ${nothingYet ? "text-muted" : ""}`}
                      style={{ fontWeight: 300 }}
                    >
                      {periodEarnings != null ? (
                        formatGBP(periodEarnings)
                      ) : nothingYet || earningsGaveUp ? (
                        "—"
                      ) : (
                        <FindingData className="text-[13px]" />
                      )}
                    </div>
                    <div className="pb-1">
                      <Sparkline values={earningsSeries} />
                    </div>
                  </div>
                  {beforeWeStarted ? (
                    <p className="mt-1.5 text-[12px] text-muted">
                      {phrase} pre-dates the portal&apos;s own figures.
                    </p>
                  ) : nothingYet ? (
                    <p className="mt-1.5 text-[12px] text-muted">
                      {phrase} hasn&apos;t happened yet.
                    </p>
                  ) : periodEarnings == null && liveMonthPending ? (
                    <p className="mt-1.5 text-[12px] text-muted">
                      {monthLabel(ANCHOR).split(" ")[0]} is still in progress — your earned figure lands at
                      month-end.
                    </p>
                  ) : periodEarnings == null && earningsGaveUp ? (
                    // The dash above says there's no number; this says why, so
                    // it can't be read as a zero.
                    <ReasonLine reason={earningsReason} />
                  ) : periodEarnings != null && missingMonths.length ? (
                    // Say what the total is a total OF. A three-month heading
                    // over a two-month sum is the failure this page guards
                    // against, so the shortfall is named rather than hidden.
                    <p className="mt-1.5 text-[12px] text-muted">
                      Covers {phraseOf(periodMonths.filter((m) => !missingMonths.includes(m)))} —
                      nothing recorded yet for {phraseOf(missingMonths)}.
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-auto flex flex-wrap gap-2 pt-3 text-[12px]">
                {periodMonths.length > 1 && avgPerMonth != null ? (
                  <span className="rounded-full bg-page px-2.5 py-1 text-muted">
                    Avg <span className="font-semibold text-ink tnum">{formatGBP(avgPerMonth)}</span>/mo
                  </span>
                ) : null}
                {periodMonths.length > 1 && bestVal != null ? (
                  <span className="rounded-full bg-page px-2.5 py-1 text-muted">
                    Best <span className="font-semibold text-ink tnum">{formatGBP(bestVal)}</span>
                    {bestLabel ? ` · ${bestLabel}` : ""}
                  </span>
                ) : null}
                {nothingYet ? null : (
                  <span className="rounded-full bg-page px-2.5 py-1 text-muted">
                    {coveredIdx.length}
                    {coveredIdx.length === periodMonths.length ? "" : ` of ${periodMonths.length}`} month
                    {periodMonths.length === 1 && coveredIdx.length === 1 ? "" : "s"} of data
                  </span>
                )}
              </div>
            </div>

            {/* stacked on mobile: a short horizontal rule instead */}
            <div className="mx-6 border-t border-black/[0.08] lg:hidden" />

            {(() => {
              const detail = stats.portfolioDetail;
              const fullyManaged = detail?.managed ?? stats.portfolio.managed.value ?? 0;
              const letOnly = detail?.letOnly ?? 0;
              // Straight from the as-at-today block, never from the funnel
              // tiles below: those follow the picker, and the mix is a picture
              // of right now whatever the picker says.
              const onMarket = stats.asAtToday.onMarket?.value ?? 0;
              const letAgreed = stats.asAtToday.pipeline?.value ?? 0;
              const totalProps = (detail?.total ?? fullyManaged + letOnly) + onMarket + letAgreed;
              const rentRoll = stats.portfolio.rentRoll.value;
              const estFees = rentRoll != null ? rentRoll * MGMT_FEE_RATE : null;
              // One hue, four shades — the brand red graded dark→light so the
              // mix reads as one story instead of a rainbow.
              const segments = [
                { label: "Fully managed", value: fullyManaged, color: "#e31f36" },
                { label: "Let only", value: letOnly, color: "#8f1322" },
                { label: "Let agreed", value: letAgreed, color: "#f0808d" },
                { label: "On market", value: onMarket, color: "#f8ccd2" },
              ].filter((s) => s.value > 0);
              return (
                <div className="relative flex h-full flex-col p-5">
                  {/* the split — deliberately stops short of top and bottom */}
                  <div className="absolute bottom-6 left-0 top-6 hidden w-px bg-black/[0.08] lg:block" />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                        <DoodleIcon name="pie" size={16} className="text-accent" />
                        Your portfolio mix
                      </div>
                      {/* Never takes the period label: REX and PayProp both
                          export current state, so "your portfolio as it stood
                          in April" isn't something either can answer. */}
                      <p className="mt-1 text-[11px] text-muted">As at {asAtLabel}</p>
                    </div>
                    <SourceBadge
                      source={stats.portfolio.managed.source}
                      note={stats.portfolio.managed.note}
                      asOf={stats.portfolio.managed.asOf}
                    />
                  </div>

                  {/* The street across the top; the number stands on its own.
                      Hovering the number (or its little icon) pops the breakdown. */}
                  <div className="relative mt-2 min-h-[150px] flex-1">
                    <div className="group relative ml-5 w-fit cursor-default pt-3">
                      <div className="flex items-center gap-2">
                        <span className="stat-value text-[44px] leading-none" style={{ fontWeight: 300 }}>{formatNum(totalProps)}</span>
                        <DoodleIcon name="info" size={15} className="mb-4 text-muted transition group-hover:text-ink" />
                      </div>
                      <div className="mt-1 text-[12px] text-muted">Properties</div>
                      {/* the hover pop-out with the mix */}
                      <div className="pointer-events-none absolute left-0 top-[calc(100%+6px)] z-20 min-w-[190px] scale-95 rounded-xl border border-line bg-card p-3 opacity-0 shadow-lg transition-all duration-200 group-hover:pointer-events-auto group-hover:scale-100 group-hover:opacity-100">
                        <div className="grid gap-1.5">
                          {segments.map((seg) => (
                            <span key={seg.label} className="flex items-center gap-2 text-[12px] text-muted">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: seg.color }} />
                              <span className="flex-1 text-ink">{seg.label}</span>
                              <span className="tnum">{formatNum(seg.value)}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    {/* the street stands on the divider — its drawn ground line
                        lands on the border below (the crop leaves ~7px under it) */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/illustrations/buildings-street.png"
                      alt=""
                      aria-hidden
                      // the street stands on the divider — its drawn ground line
                      // lands on the border below (the crop leaves ~7px under it)
                      className="pointer-events-none absolute -bottom-[7px] right-0 max-w-[62%]"
                    />
                  </div>

                  {/* rent roll underneath, with the supporting stats */}
                  <div className="mt-auto grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4">
                    <div>
                      <div className="stat-value text-[17px]" style={{ fontWeight: 300 }}>
                        {stats.portfolio.rentRoll.display ??
                          (gaveUp ? "—" : <FindingData className="text-[13px]" />)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted">Rent roll / month</div>
                    </div>
                    <div>
                      <div className="stat-value text-[17px]" style={{ fontWeight: 300 }}>
                        {estFees != null ? (
                          formatGBP(estFees)
                        ) : gaveUp ? (
                          "—"
                        ) : (
                          <FindingData className="text-[13px]" />
                        )}
                      </div>
                      <div
                        className="mt-0.5 text-[11px] text-muted"
                        title="Estimated at ~9% of rent roll — the actual management fee and your share are confirmed with head office."
                      >
                        Est. fees · ~9%
                      </div>
                    </div>
                    <div>
                      <div className="stat-value text-[17px]" style={{ fontWeight: 300 }}>
                        {/* Terminal on the first response, like RLP cover
                            below: avgRent only ever comes off portfolioDetail,
                            a synchronous seed lookup that either arrived with
                            these stats or is never coming. Nothing is gathering
                            it, so it never animates. */}
                        {detail?.avgRent != null ? formatGBP(detail.avgRent) : "—"}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted">Avg rent</div>
                    </div>
                    <div>
                      <div className="stat-value text-[17px]" style={{ fontWeight: 300 }}>
                        {detail ? `${formatNum(detail.rlpLec)}/${formatNum(detail.managed)}` : "—"}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted" title="Managed properties covered by Rent & Legal Protection (incl. LEC).">
                        RLP cover
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>

          {/* ---- THE BASICS ---- one quiet box, four figures inside */}
          <section className="enter enter-up" style={enterAt(1100)}>
            <div className="card card-lift p-5">
              <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                <DoodleIcon name="calendar" size={16} className="text-accent" />
                {periodHeading}
              </h2>
              <div className="relative mt-4 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/illustrations/notioly/moving.svg"
                  alt=""
                  aria-hidden
                  className="pointer-events-none absolute -top-14 right-0 hidden h-[140px] lg:block"
                />
                {(
                  [
                    [
                      "marketAppraisals",
                      "Market appraisals",
                      stats.funnel.marketAppraisals,
                      stats.funnelSeries?.marketAppraisals ?? [],
                    ],
                    ["listings", "Listings", stats.funnel.listings, []],
                    // Prefer the live PayProp count when we also hold its rows,
                    // so the tile and the list it opens never disagree.
                    ["moveIns", "Move-ins", moveInsStat, stats.funnelSeries?.moveIns ?? []],
                    // Pipeline is a live view of Propoly and nothing else may
                    // answer for it. The seed row count used to stand in
                    // whenever the selected period was the live month — which
                    // was harmless while that month WAS July, and became a
                    // July count wearing an August label the moment it wasn't.
                    // If Propoly doesn't answer, the API's reason is shown.
                    ["pipeline", "Pipeline", stats.funnel.pipeline, []],
                  ] as const
                ).map(([key, label, stat, series]) => {
                  const open = drill === key;
                  const meta = fb?.[key];
                  const state = figureState(stat, meta, gaveUp);
                  // Only the definition-switching and as-at-today tiles need to
                  // spell out what they're counting on a single month; over a
                  // range every tile says which months it added up.
                  const caption =
                    state.kind === "unavailable"
                      ? null
                      : meta?.basis === "as-at-today"
                        ? `${meta.label} · as at ${asAtLabel}`
                        : meta && (periodMonths.length > 1 || key === "listings")
                          ? meta.label
                          : null;
                  const trend = series.filter((v) => v != null).length > 1 ? series : null;
                  return (
                    // The whole figure is the handle — clicking it opens the
                    // records underneath. Negative margin keeps the hover
                    // padding from pushing the row's spacing about.
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDrill(open ? null : key)}
                      aria-expanded={open}
                      className={`-m-2 rounded-xl p-2 text-left transition hover:bg-black/[0.02] ${
                        open ? "bg-black/[0.025]" : ""
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
                        {/* No badge on a figure with no answer — a LIVE dot
                            over a dash reads as "live zero". */}
                        {state.kind === "unavailable" ? null : (
                          <SourceBadge source={stat.source} note={stat.note} asOf={stat.asOf} compact />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`stat-value mt-1 text-[24px] ${
                            state.kind === "unavailable" ? "text-muted" : ""
                          }`}
                        >
                          {state.kind === "value" ? (
                            (stat.display ?? formatNum(stat.value))
                          ) : state.kind === "pending" ? (
                            <FindingData className="text-[13px]" />
                          ) : (
                            "—"
                          )}
                        </span>
                        {trend ? (
                          <span className="mt-1">
                            <Sparkline values={[...trend]} width={64} height={20} fill={false} strokeWidth={1.5} />
                          </span>
                        ) : null}
                        <svg
                          className="mt-1 shrink-0 text-muted transition-transform duration-500"
                          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path
                            d="M4 6l4 4 4-4"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                      {state.kind === "unavailable" ? (
                        <ReasonLine reason={state.reason} />
                      ) : caption ? (
                        <p className="mt-1 text-[11px] text-muted">{caption}</p>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {/* ---- the records behind whichever figure is open ----
                   One panel each so the outgoing list is still on screen while
                   it shrinks; the incoming one waits out that movement
                   (PANEL_STAGGER) before opening into the space. */}
              <CollapsePanel
                open={drill === "marketAppraisals"}
                delay={drill === "marketAppraisals" ? PANEL_STAGGER : 0}
              >
                <FunnelDrilldown
                  title={`Market appraisals · ${phrase}`}
                  icon="home"
                  subtitle={
                    // The API writes the definition it ACTUALLY used — a window
                    // where REX only answered the appraisals side counts
                    // something narrower, and a mixed window names the months
                    // that fell back. Repeat that rather than re-assert the
                    // combined claim from here, where it was stated flat and
                    // was sometimes untrue.
                    appraisalDrillRows
                      ? (stats.funnel.marketAppraisals.note ?? undefined)
                      : undefined
                  }
                  onClose={() => setDrill(null)}
                >
                  {fb?.marketAppraisals?.unavailable ? (
                    <DrilldownUnavailable meta={fb.marketAppraisals} />
                  ) : appraisalDrillRows == null ? (
                    <DrilldownPending
                      count={stats.funnel.marketAppraisals.value}
                      needs="REX — we couldn't reach the Appraisals search this time"
                    />
                  ) : appraisalDrillRows.length === 0 ? (
                    <p className="text-[13px] text-muted">
                      No market appraisals against your name in {phrase}.
                    </p>
                  ) : (
                    <DataTable
                      columns={appraisalDrillColumns}
                      rows={appraisalDrillRows as Rowify<AppraisalsDrillRow>[]}
                      compact
                    />
                  )}
                </FunnelDrilldown>
              </CollapsePanel>

              <CollapsePanel
                open={drill === "listings"}
                delay={drill === "listings" ? PANEL_STAGGER : 0}
              >
                <FunnelDrilldown
                  title={
                    stats.period.isLiveMonth
                      ? `Listings · as at ${asAtLabel}`
                      : `Listings instructed · ${phrase}`
                  }
                  icon="megaphone"
                  subtitle={
                    listingDrillRows
                      ? "Your live book in REX, as it stands today. The figure above counts what's on the market now; the let-agreed ones are listed here too."
                      : undefined
                  }
                  onClose={() => setDrill(null)}
                >
                  {fb?.listings?.unavailable ? (
                    <DrilldownUnavailable meta={fb.listings} />
                  ) : listingDrillRows == null ? (
                    <DrilldownPending
                      count={stats.funnel.listings.value}
                      needs={
                        stats.period.isLiveMonth
                          ? "REX Listings — we couldn't reach the search this time"
                          : `REX — it can count the listings you instructed in ${phrase}, but the per-property records for a past window aren't wired through yet`
                      }
                    />
                  ) : listingDrillRows.length === 0 ? (
                    <p className="text-[13px] text-muted">
                      Nothing on the market against your name right now.
                    </p>
                  ) : (
                    <DataTable
                      columns={listingDrillColumns}
                      rows={listingDrillRows as Rowify<ListingsDrillRow>[]}
                      compact
                    />
                  )}
                </FunnelDrilldown>
              </CollapsePanel>

              <CollapsePanel
                open={drill === "moveIns"}
                delay={drill === "moveIns" ? PANEL_STAGGER : 0}
              >
                <FunnelDrilldown
                  title={`Move-ins · ${phrase}`}
                  icon="key"
                  subtitle={
                    moveInDrillRows
                      ? `Tenancies starting in ${phrase} on your properties, live from PayProp. Attributed using today's property book.`
                      : undefined
                  }
                  onClose={() => setDrill(null)}
                >
                  {fb?.moveIns?.unavailable ? (
                    <DrilldownUnavailable meta={fb.moveIns} />
                  ) : moveInDrillRows == null ? (
                    <DrilldownPending
                      count={moveInsStat.value}
                      needs="PayProp — we couldn't match your property book this time"
                    />
                  ) : moveInDrillRows.length === 0 ? (
                    <p className="text-[13px] text-muted">
                      No tenancies start on your properties in {phrase}.
                    </p>
                  ) : (
                    <DataTable
                      columns={moveInDrillColumns}
                      rows={moveInDrillRows as Rowify<MoveInsDrillRow>[]}
                      compact
                    />
                  )}
                </FunnelDrilldown>
              </CollapsePanel>

              <CollapsePanel
                open={drill === "pipeline"}
                delay={drill === "pipeline" ? PANEL_STAGGER : 0}
              >
                <FunnelDrilldown
                  title={`Pipeline · as at ${asAtLabel}`}
                  icon="list"
                  subtitle={
                    pipelineDrillRows
                      ? "Live from Propoly — your deals in progression, closest to keys first."
                      : "Deals in progression, from offer through to keys."
                  }
                  onClose={() => setDrill(null)}
                >
                  {fb?.pipeline?.unavailable ? (
                    <DrilldownUnavailable meta={fb.pipeline} />
                  ) : pipelineDrillRows == null ? (
                    <DrilldownPending
                      count={stats.funnel.pipeline?.value ?? null}
                      needs="Propoly — we couldn't reach your deals this time"
                    />
                  ) : pipelineDrillRows.length === 0 ? (
                    <p className="text-[13px] text-muted">
                      Nothing in progression on Propoly right now.
                    </p>
                  ) : (
                    <DataTable
                      columns={pipelineDrillColumns}
                      rows={pipelineDrillRows as Rowify<PipelineDrillRow>[]}
                      compact
                    />
                  )}
                </FunnelDrilldown>
              </CollapsePanel>
            </div>
          </section>

          {/* ---- FORECAST SNAPSHOT + CONVERSIONS ---- open, side by side */}
          <section className="enter enter-up grid gap-4 lg:grid-cols-2" style={enterAt(1300)}>
            <div className="card card-lift p-5">
              <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                <DoodleIcon name="trend-up" size={16} />
                Build your forecast
              </h2>
              <div className="mt-2">
                <ForecastBuilder
                  monthKeys={MONTH_KEYS}
                  monthLabels={MONTH_LABELS}
                  actualsNetIncome={actualsArr}
                  // ANCHOR, deliberately — NOT period.forecastMonth. The
                  // builder reads this as editableFrom: the first draggable
                  // dot, the start of the forecast total, and the month under
                  // the "This month" caption. Following the picker backwards
                  // ("By month → March") made March draggable, and dragging it
                  // PUTs a forecast over a closed month that already has an
                  // actual. The forward plan starts where the data ends.
                  currentMonthIndex={monthIdx(ANCHOR)}
                  savedForecasts={forecastHistory}
                  currentManaged={managed}
                  avgFeePerProperty={avgFeePerProperty}
                  onSaved={() => {}}
                  bare
                  compact
                />
              </div>
            </div>

            {c ? (
              <div className="card card-lift flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                      <DoodleIcon name="target" size={16} />
                      Conversion rates
                    </h2>
                    {/* Both rates now divide by listings INSTRUCTED in the same
                        window as their numerator, so the label can name one
                        period for the whole block. */}
                    <p className="mt-1 text-[11px] text-muted">{phrase}</p>
                  </div>
                  {/* The block was hardcoded to snapshot, so a rate derived
                      from live REX counts still showed as stale. Report what
                      the figures are actually built from. */}
                  <SourceBadge
                    source={c.maToListing.source}
                    asOf={c.maToListing.asOf ?? SNAP}
                    note={
                      c.maToListing.note ??
                      "Derived from your sales funnel in the TLE Business Dashboard snapshot."
                    }
                  />
                </div>
                <div className="my-auto grid grid-cols-3 gap-2 py-4">
                  {/* The em-dash ring already reads as "no answer"; the reason
                      underneath is what stops it reading as zero. */}
                  {/* Even when it answers, its denominator is a rolling 30 days
                      against a calendar-month numerator — so it keeps a caption
                      whichever way it lands. */}
                  <Gauge
                    label="Lead → MA"
                    pct={c.leadToMa.value}
                    sub={cb?.leadToMa?.unavailable ?? cb?.leadToMa?.label}
                  />
                  <Gauge
                    label="MA → Listing"
                    pct={c.maToListing.value}
                    sub={cb?.maToListing?.unavailable}
                  />
                  <Gauge
                    label="Listing → Move-in"
                    pct={c.listingToMoveIn.value}
                    sub={cb?.listingToMoveIn?.unavailable}
                  />
                </div>
              </div>
            ) : null}
            {/* Two possible sources and they are NOT interchangeable: PayProp's
                live tenancy starts for the selected period, or the July seed
                list. The heading names whichever one is actually below it, so
                the old failure — July's seven rows sitting under an August
                title because the seed was the unconditional fallback — can't
                recur. */}
            <Collapsible
              title={`My move-ins · ${moveInDrillRows ? phrase : monthLabel(ANCHOR)}`}
              badge={moveInDrillRows ? moveInDrillRows.length : stats.moveIns.length}
              icon="key"
            >
              {moveInDrillRows ? (
                moveInDrillRows.length ? (
                  <DataTable
                    columns={liveMoveInColumns}
                    rows={moveInDrillRows as Rowify<MoveInsDrillRow>[]}
                    compact
                  />
                ) : (
                  <p className="text-[13px] text-muted">
                    Nothing started on your properties in {phrase}.
                  </p>
                )
              ) : stats.moveIns.length ? (
                <DataTable columns={moveInColumns} rows={stats.moveIns as Rowify<MoveInRow>[]} compact />
              ) : beforeWeStarted ? (
                <p className="text-[13px] text-muted">
                  {phraseOf(preLiveMonths)} pre-dates the portal pulling its own figures, which
                  started in {monthLabel(LIVE_START)} — there's no per-partner move-in list for it.
                </p>
              ) : (
                // No live rows yet and no seed for this window. Say which,
                // rather than printing an authoritative-looking "none".
                <p className="text-[13px] text-muted">
                  Still gathering your move-ins for {phrase} from PayProp — the figure above fills
                  in first.
                </p>
              )}
            </Collapsible>

            {/* Propoly's live deals in progression where we have them; the seed
                forward-pipeline rows only where the API still ships them (the
                July window). "Right now" is the honest framing for the live
                list — it's a stock, not a period figure. */}
            <Collapsible
              title="My pipeline"
              badge={pipelineDrillRows ? pipelineDrillRows.length : stats.pipeline.length}
              icon="list"
            >
              {pipelineDrillRows ? (
                pipelineDrillRows.length ? (
                  <DataTable
                    columns={livePipelineColumns}
                    rows={pipelineDrillRows as Rowify<PipelineDrillRow>[]}
                    compact
                  />
                ) : (
                  <p className="text-[13px] text-muted">Nothing in progression on Propoly right now.</p>
                )
              ) : stats.pipeline.length ? (
                <DataTable columns={pipelineColumns} rows={stats.pipeline as Rowify<PipelineRow>[]} compact />
              ) : (
                <p className="text-[13px] text-muted">
                  {stats.funnelBasis?.pipeline?.unavailable ??
                    "Still reading your deals in progression from Propoly."}
                </p>
              )}
            </Collapsible>

            <Collapsible
              title="Full funnel & compliance"
              icon="analytics"
              badge={stats.compliance ? `${stats.compliance.overdue} overdue` : undefined}
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  label="Viewings"
                  stat={stats.funnel.viewings}
                  sub={fb?.viewings?.unavailable}
                />
                <StatCard
                  label="Applications"
                  stat={stats.funnel.applications}
                  sub={fb?.applications?.unavailable}
                />
                {stats.funnel.liveListings ? <StatCard label="Live listings" stat={stats.funnel.liveListings} /> : null}
                {stats.conversions?.gciPerMoveIn?.value != null ? (
                  <StatCard
                    label="GCI per move-in"
                    stat={stats.conversions.gciPerMoveIn}
                    sub={phrase}
                  />
                ) : earningsPerMoveIn != null ? (
                  // A different figure from GCI per move-in — what PayProp
                  // actually paid the partner, over the move-ins they had in
                  // the same window — so it carries its own name.
                  <StatCard
                    label="Your earnings per move-in"
                    stat={{
                      value: earningsPerMoveIn,
                      display: formatGBP(earningsPerMoveIn),
                      source: "derived",
                      note: `${formatGBP(periodEarnings)} paid to you ÷ ${stats.funnel.moveIns.value} move-ins, ${phrase}`,
                      asOf: stats.asAtToday.asOf,
                    }}
                    sub={phrase}
                  />
                ) : null}
              </div>
              {stats.compliance ? (
                <div className="mt-4 flex flex-wrap items-end gap-6 border-t border-line pt-4">
                  <div>
                    <div
                      className={`stat-value text-[22px] ${
                        stats.compliance.overdue === 0
                          ? "text-green-600"
                          : stats.compliance.pctOverdue >= 50
                            ? "text-red-600"
                            : "text-amber-600"
                      }`}
                    >
                      {formatNum(stats.compliance.overdue)}
                    </div>
                    <div className="mt-0.5 text-xs text-muted">Compliance overdue</div>
                  </div>
                  <div>
                    <div className="stat-value text-[22px]">{formatNum(stats.compliance.upcoming)}</div>
                    <div className="mt-0.5 text-xs text-muted">Upcoming (60 days)</div>
                  </div>
                  <div>
                    <div className="stat-value text-[22px]">{formatNum(stats.compliance.total)}</div>
                    <div className="mt-0.5 text-xs text-muted">Total tracked</div>
                  </div>
                  {stats.complianceUnchecked ? (
                    <div>
                      <div className="stat-value text-[22px] text-muted">
                        {formatNum(stats.complianceUnchecked)}
                      </div>
                      <div className="mt-0.5 text-xs text-muted">
                        Couldn&apos;t check
                        <span className="block text-[11px]">not counted above</span>
                      </div>
                    </div>
                  ) : null}
                  <div className="ml-auto self-start text-right">
                    {/* Compliance is a state, not a flow — it has no period. The
                        badge must say WHICH state, though: a live REX roll-up
                        stamped with the snapshot date would date today's
                        certificates to July. */}
                    {stats.complianceLive ? (
                      <SourceBadge
                        source="live-rex"
                        asOf={stats.asAtToday.asOf}
                        note="Counted live from REX across your properties. Expired and never-recorded certificates both count as overdue; properties REX couldn't fully read are left out rather than assumed compliant."
                      />
                    ) : (
                      <SourceBadge source="snapshot" asOf={SNAP} note="Compliance counts from REX PM via the snapshot." />
                    )}
                    <div className="mt-1 text-[11px] text-muted">Where things stand today</div>
                  </div>
                </div>
              ) : null}
            </Collapsible>
          </section>
        </>
      ) : null}
    </div>
  );
}
