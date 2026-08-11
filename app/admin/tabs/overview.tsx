"use client";

// Admin tab: Overview — a stat-for-stat MIRROR of Susan's Base44 dashboard
// ("KPI Overview" at tle-business-dashboard.base44.app, captured 21 Jul 2026):
// same sections, same order, same boxes, same notes. Our upgrade on top:
// tiles whose figure we can source live (REX business sums, Propoly move-ins)
// render white with a green LIVE dot; everything still on the snapshot is
// dimmed grey so what's live and what isn't is obvious at a glance.
//
// Section order (hers): headline band → Agent Headcount → Partner
// Productivity & Ramp → Business KPIs (Sales Funnel) → Conversion Rates →
// MAs by Partner Type → Monthly GCI vs Budget → Year on Year Growth.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Bars from "@/components/charts/Bars";
import type { SeedData, PeriodKpis } from "@/lib/seed-data";
import type { StatValue } from "@/lib/types";
import { exVat, formatNum, monthLabel } from "@/lib/format";
import { HISTORY_FLOOR, liveMonth, withinHistory } from "@/lib/roster";


interface LiveBusiness {
  month: string;
  agentsCounted?: number;
  agentsTotal?: number;
  totals?: { marketAppraisals: number; onMarketListings: number; pipeline: number; managed: number; rentRoll: number };
  propoly?: {
    month: string;
    pipelineTotal: number;
    pipelineByStage: { key: string; label: string; count: number }[];
    moveInsThisMonth: number;
    generatedAt: string;
  } | null;
  monthCounts?: {
    applications: number | null;
    newListings: number | null;
    viewings: number | null;
    marketAppraisals: number | null;
    combinedMas: number | null;
  } | null;
  masByType?: { total: number; tle: number; tleDual: number; unmatched: number } | null;
  rlpMtd?: { total: number; fullyManaged: number } | null;
  teg?: {
    activeAgents: number;
    tlePrimary: number;
    tleDual: number;
    byStatus: Record<string, number>;
    byPackage: Record<string, number>;
    startingSoon: number;
    startersYtd: number;
    leaversYtd: number;
    varianceYtd: number;
    generatedAt: string;
  } | null;
  generatedAt?: string;
}

interface OverviewPayload {
  month: string;
  headline: SeedData["headline"];
  headcount: SeedData["headcount"];
  partnerRamp: SeedData["partnerRamp"];
  funnel: SeedData["businessFunnel"];
  conversions: SeedData["conversions"];
  masByPartnerType: SeedData["masByPartnerType"];
  yoyGrowth: SeedData["yoyGrowth"];
  gciByMonth: { labels: string[]; actual: (number | null)[]; budget: null; budgetNote: string };
  sources: SeedData["sources"];
  periods: Record<string, PeriodKpis>;
}

/* --------------------------- the live month pill --------------------------- */
// This page used to hardcode July as "the current month" in five places: the
// pill order, the default selection, the `isCurrent` test and both live
// fetches. On 1 August that made the live layer pull July's figures and badge
// them live, under a pill labelled "July MTD" — which is what Susan was
// looking at when she said she couldn't see the updated month.
//
// Now the current month comes off the clock. The pill for it is SYNTHETIC: the
// seed has no entry for it and must never be allowed to supply one, because
// the fallback (`?? d.periods.jul`) would quietly put July's KPIs under it.

const LIVE = liveMonth();
const SHORT_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthKey = (m: string) => SHORT_KEYS[Number(m.slice(5, 7)) - 1];
/** The pill for the month we're standing in. */
const LIVE_KEY = monthKey(LIVE);
const LIVE_YEAR = LIVE.slice(0, 4);
const liveIdx = Number(LIVE.slice(5, 7)) - 1;

/** Every CLOSED month of this year, newest first — the history pills. */
const CLOSED = Array.from({ length: liveIdx }, (_, i) => `${LIVE_YEAR}-${String(i + 1).padStart(2, "0")}`).reverse();

// Period order: the live month first, then closed months newest-first, then
// the quarters that have completed, then year to date.
const PERIOD_ORDER = [
  LIVE_KEY,
  ...CLOSED.map(monthKey),
  "q2",
  "q1",
  "ytd",
] as const;

// Which stored months make up each period pill. Built from the closed months
// rather than typed out, so it can't fall behind the calendar the way the
// hardcoded list did — a quarter only appears once all three of its months
// have actually closed.
const quarter = (months: string[]) => (months.every((m) => CLOSED.includes(m)) ? months : null);
const PERIOD_MONTHS: Record<string, string[]> = {
  ...Object.fromEntries(CLOSED.map((m) => [monthKey(m), [m]])),
  ...(quarter([`${LIVE_YEAR}-04`, `${LIVE_YEAR}-05`, `${LIVE_YEAR}-06`])
    ? { q2: [`${LIVE_YEAR}-04`, `${LIVE_YEAR}-05`, `${LIVE_YEAR}-06`] }
    : {}),
  ...(quarter([`${LIVE_YEAR}-01`, `${LIVE_YEAR}-02`, `${LIVE_YEAR}-03`])
    ? { q1: [`${LIVE_YEAR}-01`, `${LIVE_YEAR}-02`, `${LIVE_YEAR}-03`] }
    : {}),
  // Closed months only — the live month is added on top where a period needs it.
  ytd: [...CLOSED].reverse(),
};

/**
 * A period with no stored figures — every tile reads "—" until the live layer
 * supplies one. Used for the current month, which by definition has no seed
 * entry: the alternative was falling back to July, i.e. printing last month's
 * numbers under this month's heading.
 */
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function emptyPeriod(key: string): PeriodKpis {
  const idx = SHORT_KEYS.indexOf(key);
  const label = idx >= 0 ? `${MONTH_NAMES[idx]} MTD` : key.toUpperCase();
  // NOT "live-rex": Tile keys its green border and pulsing LIVE chip off
  // source.startsWith("live-"), so a null dressed as live rendered an empty
  // tile that claimed to be a live reading — and promised it would "fill in",
  // which for the deliberately-gated stock tiles is false by construction.
  const none = (): StatValue => ({
    value: null,
    display: "—",
    source: "derived",
    note: "No figure for this month on this source.",
  });
  return {
    label,
    funnel: {
      marketAppraisals: none(), listings: none(), viewings: none(),
      applications: none(), moveIns: none(), liveListings: none(), pipeline: none(),
    },
    conversions: {
      maToListing: none(), listingToMoveIn: none(), rlpConversion: none(),
      gciPerMoveIn: none(), gciPerAgent: none(),
    },
    ramp: {
      newStarters: none(), maInMonths1To2: none(),
      listingInMonths1To2: none(), moveInWithin60Days: none(),
    },
  };
}

interface HistoryFunnel {
  month: string;
  marketAppraisals: number | null;
  combinedMas?: number | null;
  listings: number | null;
  viewings: number | null;
  applications: number | null;
  moveIns: number | null;
  computedAt: string;
}

interface HistoryPayload {
  months: Record<string, HistoryFunnel>;
  yoy: {
    moveIns: { prevYtd: number; currYtd: number; from: string; to: string } | null;
    generatedAt: string;
  };
}

// Ramp cohort — one new starter cross-referenced across TEG/REX/Propoly.
interface RampStarter {
  name: string;
  email: string | null;
  dateLaunched: string;
  rexId: string | null;
  windowEnd: string;
  marketAppraisals: number | null;
  listings: number | null;
  moveIns: number | null;
}
interface RampPayload {
  configured: boolean;
  starters: RampStarter[];
  stale?: boolean;
}

/* --------------------------------- tiles --------------------------------- */

// The mirror's building block. Live figures pop (white card, green dot);
// snapshot figures are deliberately dimmed — James's "grey them out so you
// can see what's not live yet".
function Tile({
  label,
  stat,
  sub,
  flag,
  compact = false,
}: {
  label: string;
  stat: StatValue;
  sub?: string | null;
  /** Set → single red dot under the figure; the text is the hover reason. */
  flag?: string | null;
  /** Denser tile for the headline band — smaller number so £ figures fit. */
  compact?: boolean;
}) {
  const isLive = stat.source.startsWith("live-");
  const isManual = stat.source === "manual";
  const value = stat.display ?? (stat.value != null ? formatNum(stat.value) : "—");
  return (
    <div
      className={`relative rounded-xl border text-center transition ${compact ? "p-2.5" : "p-3"} ${
        isLive
          ? "border-green-200 bg-white shadow-sm"
          : isManual
            ? "border-amber-200 bg-white"
            : "border-line bg-page/70"
      }`}
      title={stat.note ?? undefined}
    >
      {isLive ? (
        <span className={`absolute inline-flex items-center gap-1 font-semibold text-green-600 ${compact ? "right-1.5 top-1.5 text-[8px]" : "right-2 top-2 text-[9px]"}`}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
          LIVE
        </span>
      ) : isManual ? (
        <span className={`absolute font-semibold text-amber-600 ${compact ? "right-1.5 top-1.5 text-[8px]" : "right-2 top-2 text-[9px]"}`}>MANUAL</span>
      ) : null}
      <div
        className={`stat-value leading-tight ${compact ? "text-[19px]" : "text-[24px]"} ${
          isLive || isManual ? "text-ink" : "text-ink/60"
        }`}
      >
        {value}
      </div>
      {flag ? (
        <span
          title={flag}
          className="mx-auto mt-1 block h-1.5 w-1.5 cursor-help rounded-full bg-red-500"
          aria-label={flag}
        />
      ) : null}
      <div className={`mt-1 font-semibold uppercase tracking-wide ${compact ? "text-[9px]" : "text-[10px]"} ${isLive ? "text-ink" : "text-muted"}`}>
        {label}
      </div>
      {sub ? <div className={`mt-0.5 leading-snug text-muted ${compact ? "text-[9px]" : "text-[10px]"}`}>{sub}</div> : null}
    </div>
  );
}

const TILE_GRID = "grid gap-3 grid-cols-[repeat(auto-fit,minmax(140px,1fr))]";
// Headline band: denser so seven tiles (two with £ figures) fit without
// stretching the page or clipping the numbers.
const HEADLINE_GRID = "grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(122px,1fr))]";

/* --------------------------- ramp breakdown --------------------------- */

// Per-starter table under the ramp tiles: who ramped, from their launch date,
// with MAs / listings / move-ins in their first 60 days. This is the working
// detail behind the four aggregate tiles — collapsed by default.
function RampBreakdown({
  starters,
}: {
  starters: {
    name: string;
    dateLaunched: string;
    windowEnd: string;
    rexId: string | null;
    marketAppraisals: number | null;
    listings: number | null;
    moveIns: number | null;
  }[];
}) {
  const [open, setOpen] = useState(false);
  const fmtDay = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };
  const cell = (n: number | null) =>
    n == null ? <span className="text-muted/60" title="Couldn't match this starter in the system">—</span> : n;
  const sorted = [...starters].sort((a, b) => b.dateLaunched.localeCompare(a.dateLaunched));

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hide-when-presenting text-[12px] font-medium text-muted underline decoration-dotted underline-offset-2 transition hover:text-ink"
      >
        {open ? "Hide" : "Show"} the {starters.length} starter{starters.length === 1 ? "" : "s"} behind these numbers
      </button>
      {open ? (
        <div className="mt-2 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-line bg-page/60 text-[10px] uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-semibold">Partner</th>
                <th className="px-3 py-2 font-semibold">Launched</th>
                <th className="px-3 py-2 text-right font-semibold">MAs</th>
                <th className="px-3 py-2 text-right font-semibold">Listings</th>
                <th className="px-3 py-2 text-right font-semibold">Move-ins</th>
                <th className="px-3 py-2 font-semibold">First 60 days</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => (
                <tr key={i} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2 font-medium">
                    {s.name}
                    {s.rexId == null ? (
                      <span
                        className="ml-1.5 cursor-help text-[10px] text-amber-600"
                        title="No REX match by email — MAs/listings can't be counted for this starter"
                      >
                        ⚠
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-muted">{fmtDay(s.dateLaunched)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{cell(s.marketAppraisals)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{cell(s.listings)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{cell(s.moveIns)}</td>
                  <td className="px-3 py-2 text-[11px] text-muted">
                    to {fmtDay(s.windowEnd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

// Seed notes read "<snapshot boilerplate> · Source: <the useful bit>" — tiles
// show just the useful bit (the full note stays in the hover tooltip).
function subNote(s: StatValue | undefined | null): string | null {
  const n = s?.note;
  if (!n) return null;
  const marker = "· Source: ";
  const i = n.indexOf(marker);
  return i >= 0 ? n.slice(i + marker.length) : n;
}

/** Section shell: bold title left, tiny SOURCE right — exactly her layout. */
function Section({
  title,
  source,
  children,
}: {
  title: string;
  source?: string;
  children: ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {source ? (
          <span className="text-[10px] uppercase tracking-wide text-muted">Source: {source}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Her period pill row — now the real thing: click a period, tiles follow. */
function PeriodPills({
  options,
  active,
  onChange,
}: {
  options: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {options.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onChange(p.key)}
          aria-pressed={p.key === active}
          className={`btn-press rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
            p.key === active
              ? "bg-ink text-white"
              : "bg-page text-muted hover:text-ink"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------- tab ---------------------------------- */

export default function Overview({ month }: { month: string }) {
  /*
   * `month` is the top-right picker, and it now drives this whole page.
   *
   * It used to be `void month` — the prop was accepted and thrown away, and
   * both fetches were pinned to the clock month. Changing the picker did
   * literally nothing here; the only working control was a row of internal
   * pills keyed by three-letter month name ("jul"), a vocabulary that cannot
   * even express September 2025 because it carries no year. Those pills are
   * gone. One control, one answer.
   */
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveBusiness | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [hist, setHist] = useState<HistoryPayload | null>(null);
  const [ramp, setRamp] = useState<RampPayload | null>(null);
  // The ramp cohort keeps its own pill row — it selects a COHORT of starters
  // by launch month, which is a different question from "what happened in
  // August", and collapsing the two would silently change what it counts.
  const [rampKey, setRampKey] = useState<string>("ytd");
  // Clamped to the floor: before Sept 2025 the viewing appointment types
  // didn't exist, so Rex returns a real zero that reads as a trading figure.
  const sel = withinHistory(month);
  const isCurrent = sel === LIVE;
  /** "August 2026" — what every heading on this page is an answer to. */
  const selLabel = monthLabel(sel);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/overview?month=${sel}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Overview fetch failed (${res.status})`);
        const payload = (await res.json()) as OverviewPayload;
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setError("Couldn't load the business overview.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sel]);

  // Live layer (REX business sums + Propoly) — upgrades matching tiles.
  // The API answers instantly with the last-good figures (flagged `stale`)
  // while it re-sweeps REX in the background — poll a few times to swap the
  // fresh numbers in as soon as they land.
  /*
   * The live sweep, with cancellation — which it did not have, and which was
   * the worst defect on this page.
   *
   * Three things conspired. loadLive re-enters itself via setTimeout every 6s
   * while the server reports `stale`; the effect that drives it returned no
   * cleanup (the only one of four here that didn't); and setLive() wrote
   * unconditionally. So switching month left the OLD month's poll chain alive,
   * and six seconds later it wrote its figures into state while every heading
   * said the new month. Two quick picks did it without any timer at all,
   * because a cached month answers in milliseconds and a cold one sweeps for
   * ~15s, so replies do not arrive in the order they were asked for.
   *
   * Not theoretical: the route returns stale:true whenever a persisted
   * snapshot exists and the memory cache is cold, and snapshots exist for 8 of
   * the 12 months the picker offers. Measured contamination: RLP flipping
   * 100% (Dec 2025) -> 58% (Aug 2026), MA-split total 26 -> 3.
   *
   * Belt and braces: a cancelled flag, a cleared timer, AND a check that the
   * payload's own `month` matches what we asked for.
   */
  const staleRetries = useRef(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Each month gets its own retry budget. Sharing one counter handed a
    // still-running old chain a fresh budget on every month change.
    let retries = 0;

    const run = async (refresh = false) => {
      if (cancelled) return;
      setLiveLoading(true);
      try {
        const res = await fetch(
          `/api/admin/live-business?month=${sel}${refresh ? "&refresh=1" : ""}`,
          { cache: "no-store" }
        );
        const j = (await res.json()) as LiveBusiness & { configured?: boolean; stale?: boolean };
        if (cancelled) return;
        // The payload says which month it is. Never render a month we didn't
        // ask for, whatever raced its way back here.
        if (j.month && j.month !== sel) return;
        setLive(j);
        if (j.stale && retries < 7) {
          // Progressive backoff, not a flat 6s. Measured on a warm month the
          // server answered its polls in 262ms, 29ms, 17ms and 19ms — but the
          // fixed interval meant the tiles didn't settle until t+18.3s. Almost
          // all of that wait was ours, not PayProp's or Rex's. Start fast,
          // then ease off so a genuinely cold sweep isn't hammered.
          const backoff = [400, 800, 1500, 3000, 5000, 6000, 6000][retries] ?? 6000;
          retries += 1;
          timer = setTimeout(() => void run(), backoff);
          return; // keep the refreshing chip up while the sweep runs
        }
        setLiveLoading(false);
      } catch {
        /* live layer is an upgrade — the rest of the page still renders */
        if (!cancelled) setLiveLoading(false);
      }
    };

    // Clear the previous month's figures rather than leaving them on screen,
    // LIVE-badged, under the new month's heading for the length of a sweep.
    // The funnel tiles fall back to stored history, but RLP and the MA split
    // have no fallback at all — they would simply show the wrong month.
    setLive(null);
    staleRetries.current = 0;
    void run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sel]);

  /** Manual "Refresh live" — forces a re-sweep of the selected month. */
  const loadLive = useCallback(
    async (refresh = true) => {
      setLiveLoading(true);
      try {
        const res = await fetch(
          `/api/admin/live-business?month=${sel}${refresh ? "&refresh=1" : ""}`,
          { cache: "no-store" }
        );
        const j = (await res.json()) as LiveBusiness & { configured?: boolean; stale?: boolean };
        if (!j.month || j.month === sel) setLive(j);
      } catch {
        /* leave whatever is on screen */
      } finally {
        setLiveLoading(false);
      }
    },
    [sel]
  );

  // Closed-month history + like-for-like YoY. First-ever call computes and
  // stores the backfill (slow); afterwards it's served from the store.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/history-funnel", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as HistoryPayload;
        if (!cancelled) setHist(j);
      } catch {
        /* history is an upgrade — period pills still show the snapshot */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Ramp cohort — new starters cross-referenced across TEG/REX/Propoly.
  // Stale-while-revalidate: the sweep is a couple of REX calls per starter.
  const rampRetries = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/admin/ramp", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as RampPayload;
        if (cancelled) return;
        setRamp(j);
        if (j.stale && rampRetries.current < 6) {
          rampRetries.current += 1;
          setTimeout(() => void tick(), 6000);
        }
      } catch {
        /* ramp is an upgrade — the snapshot tiles still render */
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live commission from PayProp. Only the current month is meaningful here,
  // so the tiles fall back to the snapshot for any historic period.
  const [liveMoney, setLiveMoney] = useState<{
    combinedGci: number;
    agencyIncome: number;
    agentsEarning: number;
    moveIns: number | null;
  } | null>(null);
  // Year-to-date fees, straight off PayProp — the headline band's GCI.
  const [ytdMoney, setYtdMoney] = useState<{ combinedGci: number; paymentCount: number } | null>(
    null
  );
  /** Agencies PayProp wouldn't let us read. Non-empty = every £ below is short. */
  const [moneyGaps, setMoneyGaps] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const ask = () => {
      fetch(`/api/admin/payprop-live?month=${sel}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((res: {
          income?: { combinedGci: number; agencyIncome: number; agentsEarning: number } | null;
          ytd?: { combinedGci: number; paymentCount: number } | null;
          moveIns?: { count: number } | null;
          unreachable?: string[];
        }) => {
          if (cancelled) return;
          if (res.ytd) setYtdMoney({ combinedGci: res.ytd.combinedGci, paymentCount: res.ytd.paymentCount });
          if (res.unreachable) setMoneyGaps(res.unreachable);
          if (res.income) {
            setLiveMoney({
              combinedGci: res.income.combinedGci,
              agencyIncome: res.income.agencyIncome,
              agentsEarning: res.income.agentsEarning,
              moveIns: res.moveIns?.count ?? null,
            });
          }
          // The year-to-date range is a much longer walk than the month, so
          // keep asking until it lands too.
          if ((!res.income || !res.ytd) && tries++ < 40) setTimeout(ask, 5000);
        })
        .catch(() => {});
    };
    // Cleared on month change, so the previous month's money can't sit under
    // the new month's heading while this walk runs.
    setYtdMoney(null);
    setLiveMoney(null);
    ask();
    return () => {
      cancelled = true;
    };
    // The money fetch had NO month param and [] deps: of the five fetches on
    // this page it was the one most obviously wrong, because its tiles are
    // labelled with the SELECTED month while its window was pinned to the
    // clock. Picking September 2025 showed August 2026's money under a
    // September heading.
  }, [sel]);

  const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
  // The money walk is asked for `sel`, so its figures describe the selected
  // month whichever one that is — the isCurrent gate here was left over from
  // when the fetch was pinned to the clock.
  const liveForThisPeriod = liveMoney;

  const liveGciPerMoveIn: StatValue | null =
    liveForThisPeriod && liveForThisPeriod.moveIns
      ? {
          // exc VAT, same basis as the accounts spreadsheet the rest of this
          // page's history is seeded from — PayProp's wire amounts include it.
          value: Math.round(exVat(liveForThisPeriod.combinedGci) / liveForThisPeriod.moveIns),
          display: gbp(exVat(liveForThisPeriod.combinedGci) / liveForThisPeriod.moveIns),
          source: "live-payprop",
          note: `${gbp(exVat(liveForThisPeriod.combinedGci))} commission exc VAT ÷ ${liveForThisPeriod.moveIns} tenancies starting this month — live from PayProp.`,
        }
      : null;

  const liveGciPerAgent: StatValue | null =
    liveForThisPeriod && liveForThisPeriod.agentsEarning
      ? {
          value: Math.round(liveForThisPeriod.combinedGci / liveForThisPeriod.agentsEarning),
          display: gbp(liveForThisPeriod.combinedGci / liveForThisPeriod.agentsEarning),
          source: "live-payprop",
          note: `${gbp(liveForThisPeriod.combinedGci)} commission ÷ ${liveForThisPeriod.agentsEarning} partners who earned a fee this month — live from PayProp.`,
        }
      : null;

  if (error) {
    return <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted">Loading overview…</p>;
  }
  const d = data;

  // Per-period figures (from Susan's dashboard, all the way back to January).
  // The live month has NO seed entry and must never borrow one. The old
  // `?? d.periods.jul` fallback is exactly how July's KPIs would end up under
  // an August pill: every tile would render a plausible number sourced from a
  // month nobody selected. An empty period renders "—" until the live layer
  // fills it in, which is the honest state.
  /*
   * Susan's capture holds a value for every month of 2026 it covers, keyed by
   * three-letter month name. Map the selection back to that key rather than
   * special-casing July — hardcoding "2026-07" made every other month fall to
   * emptyPeriod, whose values are null, which in turn made the June
   * reconciliation dot unreachable on the funnel (flagIf needs a non-null
   * figure of Susan's to compare against, and June's had become null).
   *
   * The seed only describes 2026; a 2025 selection correctly gets nothing.
   */
  const seedKey = sel.startsWith("2026-") ? SHORT_KEYS[Number(sel.slice(5, 7)) - 1] : null;
  const kpiPeriod = (seedKey ? d.periods[seedKey] : undefined) ?? emptyPeriod(sel);
  const rampPeriod = d.periods[rampKey] ?? emptyPeriod(rampKey);

  // Upgrade a snapshot stat to live when the live layer carries the same
  // figure — current month (July) only; history months are final numbers.
  const asLive = (value: number, note: string, display?: string): StatValue => ({
    value,
    display,
    source: "live-rex",
    note,
    asOf: new Date().toISOString().slice(0, 10),
  });
  const funnelMas =
    live?.monthCounts?.combinedMas != null
      ? asLive(
          live.monthCounts.combinedMas,
          `Live from REX — Susan's combined-MA definition: ${live.monthCounts.marketAppraisals ?? "?"} recorded appraisals + listings with no same-month MA (June check: 41 vs her 40).`
        )
      : isCurrent && live?.totals /* current-state fallback — live month only */
        ? asLive(live.totals.marketAppraisals, "Live from REX — recorded appraisals summed across every lettings agent.")
        : kpiPeriod.funnel.marketAppraisals;
  // STOCK, not a flow: live.totals.onMarketListings is what is on the market
  // RIGHT NOW, summed across agents. Rex keeps no history of it, so it can
  // only ever answer for the live month — the gate here is load-bearing.
  const funnelLiveListings =
    isCurrent && live?.totals
      ? asLive(live.totals.onMarketListings, "Live from REX — on-market listings right now.")
      : kpiPeriod.funnel.liveListings;
  // STOCK, same as Live Listings above. Deliberately still gated.
  const funnelPipeline =
    isCurrent && live?.totals
      ? asLive(live.totals.pipeline, "Live from REX — let-agreed forward pipeline right now.")
      : kpiPeriod.funnel.pipeline;
  const funnelMoveIns: StatValue =
    live?.propoly
      ? {
          value: live.propoly.moveInsThisMonth,
          source: "live-propoly",
          note: "Live from Propoly — completed deals with a move-in date this month.",
          asOf: live.propoly.generatedAt.slice(0, 10),
        }
      : kpiPeriod.funnel.moveIns;
  // Month-bound REX counts — applications by date_received (proven field);
  // listings by created-this-month (validate via /api/admin/rex-validate).
  const funnelApplications =
    live?.monthCounts?.applications != null
      ? asLive(
          live.monthCounts.applications,
          "Live from REX — applications ACCEPTED this month (Susan's definition — validated vs her June final: 24 vs 25)."
        )
      : kpiPeriod.funnel.applications;
  const funnelListings =
    live?.monthCounts?.newListings != null
      ? asLive(
          live.monthCounts.newListings,
          "Live from REX — rental listings created this month, drafts excluded (June check: 38 vs Susan's 35)."
        )
      : kpiPeriod.funnel.listings;
  const funnelViewings =
    live?.monthCounts?.viewings != null
      ? asLive(
          live.monthCounts.viewings,
          "Live from REX — TLE viewing appointments this month, cancellations excluded (June check: 221 vs Susan's 202)."
        )
      : kpiPeriod.funnel.viewings;

  // ---- History upgrade for past-period pills ----
  // Stored live figures (validated definitions) replace the snapshot, with a
  // single red dot wherever they differ from Susan's report — James checks
  // each dot to work out why, so the dot NEVER hides the live number.
  // One month, the selected one. The pills used to map a 3-letter key to a
  // month list; the picker gives the month directly.
  const histMonths = !isCurrent ? [sel] : null;
  const histSum = (
    metric: "marketAppraisals" | "combinedMas" | "listings" | "viewings" | "applications" | "moveIns"
  ): number | null => {
    if (!histMonths || !hist) return null;
    let total = 0;
    for (const m of histMonths) {
      const v = hist.months[m]?.[metric];
      if (v == null) return null;
      total += v;
    }
    return total;
  };
  /**
   * The red "differs from Susan's report" dot.
   *
   * Susan's captured figures describe ONE window — her June-2026 year-to-date
   * report. Comparing them against an arbitrary month lights the dot on every
   * tile and tells you nothing except that June is not August, which is how a
   * useful signal becomes noise people learn to ignore. The dot now only
   * appears where the two are answers to the same question.
   */
  const comparableToSusan = sel === "2026-06";
  const flagIf = (liveVal: number, susan: StatValue): string | null =>
    comparableToSusan && susan.value != null && susan.value !== liveVal
      ? `Differs from Susan's report — her figure: ${susan.display ?? formatNum(susan.value)}. Hover the tile for our definition, then reconcile.`
      : null;
  const histUpgrade = (
    metric: "marketAppraisals" | "combinedMas" | "listings" | "viewings" | "applications" | "moveIns",
    susan: StatValue,
    note: string,
    source: StatValue["source"]
  ): { stat: StatValue; flag: string | null } | null => {
    const v = histSum(metric);
    if (v == null) return null;
    return {
      stat: { value: v, source, note, asOf: hist?.months[histMonths?.[0] ?? ""]?.computedAt?.slice(0, 10) },
      flag: flagIf(v, susan),
    };
  };
  const periodLabelBit = selLabel;
  const hMas = histUpgrade(
    "combinedMas",
    kpiPeriod.funnel.marketAppraisals,
    `Live from REX — combined MAs (recorded + listing-only, Susan's definition), ${periodLabelBit}.`,
    "live-rex"
  );
  const hListings = histUpgrade(
    "listings",
    kpiPeriod.funnel.listings,
    `Live from REX — rental listings created, drafts excluded, ${periodLabelBit}.`,
    "live-rex"
  );
  const hViewings = histUpgrade(
    "viewings",
    kpiPeriod.funnel.viewings,
    `Live from REX — TLE viewing appointments, cancellations excluded, ${periodLabelBit}.`,
    "live-rex"
  );
  const hApplications = histUpgrade(
    "applications",
    kpiPeriod.funnel.applications,
    `Live from REX — applications accepted, ${periodLabelBit}.`,
    "live-rex"
  );
  const hMoveIns = histUpgrade(
    "moveIns",
    kpiPeriod.funnel.moveIns,
    `Live from Propoly — completed deals with a move-in date, ${periodLabelBit}. Susan's Move-In Report also counts managed transfers + marketing-only, so hers can run higher.`,
    "live-propoly"
  );

  const pct = (num: number, den: number): number | null =>
    den > 0 ? Math.round((num / den) * 100) : null;

  /* ------------- the funnel AS SELECTED, whichever month that is -------------
   * One place that answers "what were the figures for the pill I clicked?".
   * The live month reads from the live sweep, a closed month from stored
   * history, and only a month with neither falls back to the snapshot.
   *
   * Everything downstream derives from THESE rather than re-testing isCurrent,
   * which is why the conversion rates were frozen: they were computed only
   * when the selected period was the current month, so every other pill showed
   * the July snapshot's percentages and the rates never moved between months.
   */
  const effMas = hMas?.stat ?? funnelMas;
  const effListings = hListings?.stat ?? funnelListings;
  const effViewings = hViewings?.stat ?? funnelViewings;
  const effApplications = hApplications?.stat ?? funnelApplications;
  const effMoveIns = hMoveIns?.stat ?? funnelMoveIns;

  /** Measured (live or stored-live), as opposed to a hand-keyed snapshot. */
  const measured = (s: StatValue | undefined): s is StatValue =>
    !!s && s.value != null && s.source.startsWith("live-");

  /**
   * A rate is only as trustworthy as its inputs: both must be measured, or the
   * snapshot's own percentage stands. A live numerator over a snapshot
   * denominator is a number nobody could source.
   */
  /**
   * A rate is only as trustworthy as its inputs: both must be measured, or the
   * snapshot's own percentage stands.
   *
   * PLUS a plausibility ceiling. Ten days into August there were 2 listings and
   * 24 move-ins, giving "Listing → Move-in 1200%" with a green LIVE dot — not
   * a counting error but a month-to-date artefact, because move-ins complete
   * against listings instructed in earlier months. Arithmetically correct and
   * completely useless, and a green dot on 1200% is what teaches someone to
   * stop trusting green dots. Above the ceiling the figure is withheld and the
   * reason is given instead.
   */
  const RATE_CEILING = 300;
  const derived = (
    num: StatValue,
    den: StatValue,
    note: string,
    fallback: StatValue
  ): StatValue => {
    if (!measured(num) || !measured(den)) return fallback;
    const v = pct(num.value as number, den.value as number);
    if (v == null) return fallback;
    if (v > RATE_CEILING) {
      // SHOW the number, but strip the live badge and say what it is. Hiding
      // it entirely was worse: the owner reported the tile as "missing", which
      // is exactly the wrong conclusion to invite. The figure is arithmetically
      // right and structurally misleading — a move-in completing this month
      // belongs to a listing instructed one to three months ago, so dividing
      // by THIS month's listings compares two different cohorts. That is most
      // visible early in a month, when the denominator has barely started.
      return {
        value: v,
        display: `${v}%`,
        source: "derived",
        note: `${num.value} ÷ ${den.value}. Not a like-for-like rate: move-ins completing now belong to listings instructed in earlier months, so early in a month this runs far above 100%. Compare closed months instead.`,
      };
    }
    return asLive(v, note, `${v}%`);
  };

  // ---- Headline YEAR-TO-DATE band, ending at the selected month ----
  // Same stored per-month figures the period pills use. GCI + Total Income
  // stay snapshot — they're PayProp figures on a route this tab doesn't call.
  // Pipeline is a right-now state metric, so it upgrades to the live REX
  // let-agreed count rather than a year sum.
  /**
   * The headline band is YEAR TO DATE, and it ends at whichever pill is
   * selected — January through that month inclusive.
   *
   * It used to sum a fixed Jan–Jun and ignore the pill entirely, so it read
   * "Jun YTD MAs 255" no matter which month you clicked. Two things were wrong
   * at once: the window never grew as months closed, and clicking July or
   * August changed nothing above the fold.
   *
   * The live month is included from the live sweep — it has no stored history
   * row yet, being unfinished — so August YTD is Jan–Jul stored plus August so
   * far, which is what "year to date" means on the 10th.
   */
  const ytdThrough = sel;
  /**
   * Year to date runs from January OF THE SELECTED YEAR up to the selected
   * month — clamped at HISTORY_FLOOR, because there is nothing trustworthy
   * before it. So picking Nov 2025 gives Sept–Nov 2025, not Jan–Nov: the
   * earlier months would be zero-viewing months masquerading as quiet ones.
   *
   * CLOSED was no use here — it only ever held months of the CURRENT year, so
   * any 2025 selection produced an empty window and a blank band.
   */
  const ytdMonths = (() => {
    const year = ytdThrough.slice(0, 4);
    const out: string[] = [];
    for (let i = 1; i <= 12; i++) {
      const m = `${year}-${String(i).padStart(2, "0")}`;
      if (m < HISTORY_FLOOR) continue;
      if (m > ytdThrough) break;
      // The live (unfinished) month has no stored row — added below.
      if (m < LIVE) out.push(m);
    }
    return out;
  })();
  const includesLive = ytdThrough >= LIVE;
  /**
   * What the band should CALL its window. "January YTD" over a window that
   * starts in September is a false label, so when the floor bites the band
   * names its true start instead.
   */
  const ytdLabel = MONTH_NAMES[Number(ytdThrough.slice(5, 7)) - 1] ?? "";
  const ytdStart = ytdMonths[0] ?? (includesLive ? LIVE : ytdThrough);
  const ytdIsPartial = ytdStart > `${ytdThrough.slice(0, 4)}-01`;
  const ytdWindowLabel = ytdIsPartial
    ? `${monthLabel(ytdStart)} → ${monthLabel(ytdThrough)}`
    : `Jan → ${monthLabel(ytdThrough)}`;

  const closedSum = (
    metric: "combinedMas" | "listings" | "applications" | "moveIns"
  ): number | null => {
    if (!hist) return null;
    let total = 0;
    for (const m of ytdMonths) {
      const v = hist.months[m]?.[metric];
      if (v == null) return null;
      total += v;
    }
    // The unfinished month has no history row — take it from the live sweep,
    // or the total would silently stop at the end of last month.
    if (includesLive) {
      const liveNow =
        metric === "moveIns"
          ? live?.propoly?.moveInsThisMonth
          : metric === "combinedMas"
            ? live?.monthCounts?.combinedMas
            : metric === "listings"
              ? live?.monthCounts?.newListings
              : live?.monthCounts?.applications;
      if (liveNow == null) return null;
      total += liveNow;
    }
    return total;
  };
  const headlineUpgrade = (
    metric: "combinedMas" | "listings" | "applications" | "moveIns",
    susan: StatValue,
    note: string,
    source: StatValue["source"]
  ): { stat: StatValue; flag: string | null } => {
    const v = closedSum(metric);
    // An incomplete window renders "—", NOT Susan's capture. The old fallback
    // put four plausible numbers from a fixed June-2026 window under whatever
    // month was selected, with the discrepancy dot forced off — and because
    // `hist` is a separate round-trip, that was the state on every first paint.
    // The only honest answers here are the real total or none.
    if (v == null) {
      return {
        stat: {
          value: null,
          display: "—",
          source: "derived",
          note: `Year-to-date needs every month in ${ytdWindowLabel}; at least one hasn't been computed yet. It fills in once the history walk finishes.`,
        },
        flag: null,
      };
    }
    return {
      stat: { value: v, source, note, asOf: new Date().toISOString().slice(0, 10) },
      flag: flagIf(v, susan),
    };
  };
  const hlMas = headlineUpgrade(
    "combinedMas",
    d.headline.mas,
    `Live from REX — combined MAs (recorded + listing-only, Susan's definition), ${ytdWindowLabel}, summed from the stored closed months.`,
    "live-rex"
  );
  const hlListings = headlineUpgrade(
    "listings",
    d.headline.listings,
    `Live from REX — rental listings created ${ytdWindowLabel}, drafts excluded, summed from the stored closed months.`,
    "live-rex"
  );
  const hlApplications = headlineUpgrade(
    "applications",
    d.headline.applications,
    `Live from REX — applications accepted ${ytdWindowLabel}, summed from the stored closed months.`,
    "live-rex"
  );
  const hlMoveIns = headlineUpgrade(
    "moveIns",
    d.headline.moveIns,
    `Live from Propoly — completed move-ins ${ytdWindowLabel}. Susan's Move-In Report also counts managed transfers + marketing-only, so hers can run higher.`,
    "live-propoly"
  );
  const hlPipeline: StatValue = live?.totals
    ? asLive(
        live.totals.pipeline,
        "Live from REX — let-agreed forward pipeline RIGHT NOW (the snapshot's 51 was the same measure as of 11 Jul)."
      )
    : d.headline.pipeline;

  // Conversion rates go live only when BOTH inputs are live — a live/snapshot
  // hybrid ratio would be a made-up number.
  // MA → Listing, for WHICHEVER month is selected — derived from the same two
  // tiles shown above it, so the rate and the figures it came from can never
  // disagree. (Recorded MAs alone gave 1200%-style nonsense; the combined
  // definition is Susan's formula.)
  const convMaToListing = derived(
    effListings,
    effMas,
    `Derived from the funnel above — listings ÷ combined MAs (Susan's formula), ${periodLabelBit}.`,
    kpiPeriod.conversions.maToListing
  );
  // RLP conversion — fully-managed share of this month's Propoly move-ins.
  // No isCurrent gate: the live-business route is now called with the selected
  // month, so rlpMtd already describes that month. Gating it here was the only
  // reason a past month fell back to July's percentage.
  const rlp = live?.rlpMtd ?? null;
  const liveRlp = rlp && rlp.total > 0 ? pct(rlp.fullyManaged, rlp.total) : null;
  const convRlp: StatValue =
    liveRlp != null && rlp
      ? asLive(
          liveRlp,
          `Live from Propoly — ${rlp.fullyManaged} of ${rlp.total} move-ins this month are fully managed. Susan's "EFM managed" rule may scope this differently — flag if it looks off.`,
          `${liveRlp}%`
        )
      : kpiPeriod.conversions.rlpConversion;

  const convListingToMoveIn = derived(
    effMoveIns,
    effListings,
    `Derived from the funnel above — move-ins ÷ listings, ${periodLabelBit}.`,
    kpiPeriod.conversions.listingToMoveIn
  );

  // MAs by partner type — live REX per-agent MAs split by the Team Hub's
  // dual-brand flag. Lettings Lite has no hub category → snapshot.
  // Same again — masByType is computed from the selected month's per-agent MAs
  // crossed with the Team Hub's dual-brand flag, so it answers for any month.
  const mbt = live?.masByType ?? null;
  const masTiles = {
    // The same combined-MA figure as the funnel tile above, whichever month is
    // selected — these two disagreeing was one of the things that made the
    // page hard to trust.
    total: mbt
      ? asLive(mbt.total, `Live from REX — MAs across all lettings agents, ${periodLabelBit}.`)
      : measured(effMas)
        ? effMas
        : d.masByPartnerType.total,
    tle: mbt
      ? asLive(
          mbt.tle,
          `Live — REX MAs by agents the Team Hub lists as TLE-primary${mbt.unmatched ? ` (includes ${mbt.unmatched} from agents not yet matched to the hub)` : ""}.`
        )
      : d.masByPartnerType.tle,
    tleDual: mbt
      ? asLive(mbt.tleDual, "Live — REX MAs by dual-brand partners (per the Team Hub).")
      : d.masByPartnerType.tleDual,
  };

  // Agent Headcount — live from the TEG Team Hub (the group's people database)
  // when the secret is configured. TLE = primary-brand Active partners; Dual =
  // partners on another brand with TLE in sub_brands. "Lettings Lite" doesn't
  // exist as a hub category (packages are Basic/Pro/Academy), so that tile
  // stays on the snapshot.
  const teg = live?.teg ?? null;
  const asTeg = (value: number, note: string, display?: string): StatValue => ({
    value,
    display,
    source: "live-teg",
    note,
    asOf: teg?.generatedAt.slice(0, 10),
  });
  const hc = {
    activeAgents: teg
      ? asTeg(teg.activeAgents, "Live from TEG Team Hub — active TLE partners (primary + dual brand).")
      : d.headcount.activeAgents,
    tle: teg
      ? asTeg(teg.tlePrimary, "Live from TEG Team Hub — partners with The Letting Experts as primary brand.")
      : d.headcount.tle,
    tleDual: teg
      ? asTeg(teg.tleDual, "Live from TEG Team Hub — partners on another Experts brand with TLE as a sub-brand.")
      : d.headcount.tleDual,
    lettingsLite: d.headcount.lettingsLite,
    startingSoon: teg
      ? asTeg(teg.startingSoon, "Live from TEG Team Hub — signed partners still onboarding.")
      : d.headcount.startingSoon,
    startersYtd: teg
      ? asTeg(
          teg.startersYtd,
          "Live from TEG Team Hub — launch date since 1 Jan. Launch dates are patchy in the hub, so this can undercount."
        )
      : d.headcount.startersYtd,
    leaversYtd: teg
      ? asTeg(teg.leaversYtd, "Live from TEG Team Hub — leave date since 1 Jan.")
      : d.headcount.leaversYtd,
    varianceYtd: teg
      ? asTeg(teg.varianceYtd, "Live from TEG Team Hub — starters minus leavers.", `${teg.varianceYtd >= 0 ? "+" : ""}${teg.varianceYtd}`)
      : d.headcount.varianceYtd,
  };

  // The live pill is offered even though the seed has no entry for it — it is
  // the whole point of the page now. Everything else still needs stored KPIs.
  // "July MTD" reads as a partial month; on a closed month it is simply wrong,
  // and on the live one the pill already says which month it is. Dropped
  // everywhere, so a total is a total.
  const stripMtd = (l: string) => l.replace(/\s*MTD$/, "");
  const pillOptions = PERIOD_ORDER.filter((k) => k === LIVE_KEY || d.periods[k]).map((k) => ({
    key: k,
    label: stripMtd(d.periods[k]?.label ?? emptyPeriod(k).label),
  }));
  // Her ramp pills say "July" rather than "July MTD".
  const rampPillOptions = pillOptions.map((p) => ({
    ...p,
    label: p.label.replace(" MTD", ""),
  }));

  // ---- Live ramp cohort, filtered by the selected period pill ----
  // A starter belongs to the period if their launch MONTH is in it (ytd =
  // whole year; jul = this month). Each starter's MA/listing/move-in counts
  // cover their first 60 days (to date). null figures don't drag a sum to 0 —
  // they're skipped, and the tile carries a live badge off the real totals.
  const rampMonths =
    rampKey === "ytd"
      ? [...(PERIOD_MONTHS.ytd ?? []), LIVE]
      : rampKey === LIVE_KEY
        ? [LIVE]
        : (PERIOD_MONTHS[rampKey] ?? []);
  const rampMonthSet = new Set(rampMonths);
  const liveCohort =
    ramp?.configured && ramp.starters
      ? ramp.starters.filter((s) => rampMonthSet.has(s.dateLaunched.slice(0, 7)))
      : null;
  const cohortSum = (key: "marketAppraisals" | "listings" | "moveIns"): number =>
    (liveCohort ?? []).reduce((t, s) => t + (s[key] ?? 0), 0);
  const rampStat = (value: number, note: string): StatValue => ({
    value,
    source: "live-teg",
    note,
    asOf: new Date().toISOString().slice(0, 10),
  });
  const periodWord = rampKey === "ytd" ? "this year" : (d.periods[rampKey]?.label ?? "").replace(" MTD", "");
  const rampNewStarters = liveCohort
    ? rampStat(liveCohort.length, `Live from TEG Team Hub — partners launched ${periodWord} (by date_launched).`)
    : rampPeriod.ramp.newStarters;
  const rampMa = liveCohort
    ? rampStat(cohortSum("marketAppraisals"), "Live from REX — market appraisals these starters recorded in their first 60 days.")
    : rampPeriod.ramp.maInMonths1To2;
  const rampListings = liveCohort
    ? rampStat(cohortSum("listings"), "Live from REX — rental listings these starters created in their first 60 days.")
    : rampPeriod.ramp.listingInMonths1To2;
  const rampMoveIns = liveCohort
    ? rampStat(cohortSum("moveIns"), "Live from Propoly — completed move-ins these starters achieved within 60 days of launch.")
    : rampPeriod.ramp.moveInWithin60Days;

  return (
    <div className="space-y-5">
      {/* ---- headline band ---- */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide">KPI Metrics</h2>
          {moneyGaps.length ? (
            <span
              className="rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700"
              title="PayProp rejected the stored credential for this agency (HTTP 400, invalid_grant). No request reaches it, so its income counts as zero — which is why every £ figure below is short. Someone with admin access must re-authorise the connection, or PayProp must issue an API key for that agency."
            >
              £ figures incomplete — {moneyGaps.map((a) => (a === "uk" ? "E&W" : "Glasgow")).join(", ")} unreachable
            </span>
          ) : null}
          <span className="text-[11px] text-muted">
            Year to date · {ytdWindowLabel} · live tiles refresh on load
          </span>
          <button
            type="button"
            onClick={() => void loadLive(true)}
            disabled={liveLoading}
            className="hide-when-presenting ml-auto inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-[12px] font-medium text-muted transition hover:text-ink disabled:opacity-50"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M13 8a5 5 0 1 1-1.46-3.54M13 3v2.5h-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {liveLoading ? "Refreshing…" : "Refresh live"}
          </button>
        </div>
        <div className={HEADLINE_GRID}>
          <Tile label={`${ytdLabel} YTD MAs`} stat={hlMas.stat} flag={hlMas.flag} compact />
          <Tile label={`${ytdLabel} YTD Listings`} stat={hlListings.stat} flag={hlListings.flag} compact />
          <Tile label={`${ytdLabel} YTD Applications`} stat={hlApplications.stat} flag={hlApplications.flag} compact />
          <Tile label={`${ytdLabel} YTD Move-ins`} stat={hlMoveIns.stat} flag={hlMoveIns.flag} compact />
          <Tile
            label={`${ytdLabel} YTD GCI exc VAT`}
            stat={
              ytdMoney
                ? {
                    value: Math.round(ytdMoney.combinedGci),
                    display: `£${Math.round(ytdMoney.combinedGci).toLocaleString("en-GB")}`,
                    source: "live-payprop",
                    note: `Live from PayProp — every fee charged since 1 January across both agencies, ${ytdMoney.paymentCount} payments.`,
                  }
                : d.headline.gciExcVat
            }
            compact
          />
          {/* Seed constant describing ONE window — the June-2026 year-to-date
              capture. It has no live source on this route, so rather than wear
              the selected month's label it only appears under its own. */}
          <Tile
            label={sel === "2026-06" ? "Jun YTD Total Income" : "Total Income"}
            stat={
              sel === "2026-06"
                ? d.headline.totalIncome
                : {
                    value: null,
                    display: "—",
                    source: "snapshot",
                    note: "Total income was captured once, as a June 2026 year-to-date figure. There is no live source for it on this page, so it is not shown for any other window rather than repeated under one.",
                  }
            }
            compact
          />
          <Tile label="Pipeline now" stat={hlPipeline} compact />
        </div>
      </div>

      {/* ---- 1. Agent Headcount ---- */}
      <Section title="Agent Headcount" source={d.sources.headcount}>
        <div className={TILE_GRID}>
          <Tile label="Active Agents" stat={hc.activeAgents} sub="Managing portfolio" />
          <Tile label="TLE" stat={hc.tle} sub="Full partner" />
          <Tile label="TLE Dual" stat={hc.tleDual} sub="Dual brand" />
          <Tile label="Lettings Lite" stat={hc.lettingsLite} sub="Lite service" />
          <Tile label="Starting Soon" stat={hc.startingSoon} sub="Signed, building pipeline" />
          <Tile label="Starters YTD" stat={hc.startersYtd} sub="TLE / TLE Dual · excl Lettings Lite" />
          <Tile label="Leavers YTD" stat={hc.leaversYtd} sub="TLE / TLE Dual · excl Lettings Lite" />
          <Tile label="Variance YTD" stat={hc.varianceYtd} sub="Net change TLE / TLE Dual" />
        </div>
      </Section>

      {/* ---- 2. Partner Productivity & Ramp Time ---- */}
      <Section
        title="Partner Productivity & Ramp Time"
        source={
          liveCohort
            ? "Live · TEG Team Hub start dates × REX MAs/listings × Propoly move-ins · first 60 days"
            : `${d.sources.headcount} · REX KPI reports · Target: MA months 1–2 · MI within 60 days`
        }
      >
        <PeriodPills options={rampPillOptions} active={rampKey} onChange={setRampKey} />
        <div className={TILE_GRID}>
          <Tile label="New Starters" stat={rampNewStarters} sub={liveCohort ? null : subNote(rampPeriod.ramp.newStarters)} />
          <Tile label="MA in Months 1–2" stat={rampMa} sub={liveCohort ? null : subNote(rampPeriod.ramp.maInMonths1To2)} />
          <Tile label="Listing in Months 1–2" stat={rampListings} sub={liveCohort ? null : subNote(rampPeriod.ramp.listingInMonths1To2)} />
          <Tile label="Move-in within 60 Days" stat={rampMoveIns} sub={liveCohort ? null : subNote(rampPeriod.ramp.moveInWithin60Days)} />
        </div>
        {liveCohort && liveCohort.length > 0 ? (
          <RampBreakdown starters={liveCohort} />
        ) : liveCohort && liveCohort.length === 0 ? (
          <p className="mt-3 text-[12px] text-muted">
            No partners launched in this period. Try the YTD pill for the full cohort.
          </p>
        ) : null}
      </Section>

      {/* ---- 3. Business KPIs — Sales Funnel ---- */}
      <Section title={`Business KPIs — ${selLabel}`} source={d.sources.businessFunnel}>
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Sales Funnel</h3>
        <div className={TILE_GRID}>
          <Tile label="Market Appraisals" stat={effMas} flag={hMas?.flag} />
          <Tile label="Listings" stat={effListings} flag={hListings?.flag} />
          <Tile label="Viewings" stat={effViewings} flag={hViewings?.flag} />
          <Tile label="Applications" stat={effApplications} flag={hApplications?.flag} />
          <Tile label="Move-ins" stat={effMoveIns} flag={hMoveIns?.flag} />
          <Tile label="Live Listings" stat={funnelLiveListings} />
          <Tile label="Forward Pipeline" stat={funnelPipeline} />
        </div>
      </Section>

      {/* ---- 4. Conversion Rates ---- */}
      {/* Follows the Business KPIs pill, exactly as on her dashboard. */}
      <Section title={`Conversion Rates — ${periodLabelBit}`} source={d.sources.conversions}>
        <div className={TILE_GRID}>
          <Tile label="MA → Listing" stat={convMaToListing} sub={subNote(convMaToListing)} />
          <Tile label="Listing → Move-in" stat={convListingToMoveIn} sub={subNote(convListingToMoveIn)} />
          <Tile label="RLP Conversion" stat={convRlp} sub={subNote(convRlp)} />
          <Tile
            label="GCI per Move-in"
            stat={liveGciPerMoveIn ?? kpiPeriod.conversions.gciPerMoveIn}
            sub={subNote(liveGciPerMoveIn ?? kpiPeriod.conversions.gciPerMoveIn)}
          />
          <Tile
            label="GCI per Agent"
            stat={liveGciPerAgent ?? kpiPeriod.conversions.gciPerAgent}
            sub={subNote(liveGciPerAgent ?? kpiPeriod.conversions.gciPerAgent)}
          />
        </div>
      </Section>

      {/* ---- 5. MAs by Partner Type ---- */}
      <Section
        title={`Market Appraisals by Partner Type${mbt ? ` — ${periodLabelBit}` : ""}`}
        source={d.sources.masByPartnerType}
      >
        <div className={TILE_GRID}>
          <Tile label="Total Appraisals" stat={masTiles.total} />
          <Tile
            label="TLE Partners"
            stat={masTiles.tle}
            sub={mbt ? null : "Split is live-month only"}
          />
          <Tile
            label="TLE Dual"
            stat={masTiles.tleDual}
            sub={mbt ? null : "Split is live-month only"}
          />
          <Tile label="Lettings Lite" stat={d.masByPartnerType.lettingsLite} />
        </div>
      </Section>

      {/* ---- 6. Monthly GCI vs Budget ---- */}
      <Section title="Monthly GCI vs Budget" source={d.sources.income}>
        <Bars
          labels={d.gciByMonth.labels}
          series={[{ name: "Actual GCI (exc VAT)", color: "#e31f36", values: d.gciByMonth.actual }]}
          format={(n) => `£${Math.round(n / 1000)}k`}
          height={240}
        />
        <p className="hide-when-presenting mt-2 text-[11px] text-muted">{d.gciByMonth.budgetNote}</p>
      </Section>

      {/* ---- 7. Year on Year Growth ---- */}
      {/* Like-for-like: 1 Jan → today vs the same window last year. */}
      <Section title="Year on Year Growth" source={d.sources.yoyGrowth}>
        <div className={TILE_GRID}>
          {d.yoyGrowth.map((g) => {
            // Total portfolio: live.totals.managed is already in the payload and
            // was simply never wired to this tile, so it sat on a snapshot.
            if (g.label === "Total portfolio" && live?.totals) {
              const stat: StatValue = {
                value: live.totals.managed,
                display: `${g.from} → ${live.totals.managed}`,
                source: "live-rex",
                note: `Live from REX — ${live.totals.managed} managed (let) properties across every lettings agent, as at today, against ${g.from} at the baseline.`,
                asOf: new Date().toISOString().slice(0, 10),
              };
              return <Tile key={g.label} label={g.label} stat={stat} />;
            }
            if (g.label === "YTD move-ins" && hist?.yoy.moveIns) {
              const { prevYtd, currYtd, to } = hist.yoy.moveIns;
              const pctUp = prevYtd > 0 ? Math.round(((currYtd - prevYtd) / prevYtd) * 100) : null;
              const stat: StatValue = {
                value: currYtd,
                display: `${prevYtd} → ${currYtd}`,
                source: "live-propoly",
                note: `Live from Propoly — completed move-ins 1 Jan–${to.slice(5)} vs the same window last year${pctUp != null ? ` (${pctUp >= 0 ? "+" : ""}${pctUp}%)` : ""}. Susan's figures also count managed transfers + marketing-only.`,
                asOf: to,
              };
              return (
                <Tile
                  key={g.label}
                  label={g.label}
                  stat={stat}
                  sub={pctUp != null ? `${pctUp >= 0 ? "+" : ""}${pctUp}% vs this time last year` : null}
                  flag={g.stat.value != null && g.stat.value !== currYtd ? `Differs from Susan's report — hers: ${g.stat.display ?? g.stat.value}` : null}
                />
              );
            }
            if (g.label === "Partner count" && teg) {
              const stat: StatValue = {
                value: teg.activeAgents,
                display: `${g.from} → ${teg.activeAgents}`,
                source: "live-teg",
                note: `Current side live from the TEG Team Hub (${teg.activeAgents} active TLE partners today); the ${g.from} baseline is from Susan's records.`,
                asOf: teg.generatedAt.slice(0, 10),
              };
              return (
                <Tile
                  key={g.label}
                  label={g.label}
                  stat={stat}
                  sub={`from ${g.from} · live now`}
                  flag={g.to !== teg.activeAgents ? `Differs from Susan's report — hers: ${g.stat.display ?? g.to}` : null}
                />
              );
            }
            return <Tile key={g.label} label={g.label} stat={g.stat} sub={subNote(g.stat)} />;
          })}
        </div>
      </Section>

      {live?.totals ? (
        <p className="hide-when-presenting text-[11px] text-muted">
          Live tiles: REX summed across {live.agentsCounted} lettings agents
          {live.propoly ? " · move-ins live from Propoly" : ""} · everything grey is the {d.headline.lastUpdated} snapshot, and
          goes live as each integration lands (PayProp next for the money figures).
        </p>
      ) : live?.propoly ? (
        <p className="hide-when-presenting text-[11px] text-muted">
          Move-ins live from Propoly · REX live sums appear on the deployed site · grey tiles are the {d.headline.lastUpdated}{" "}
          snapshot until each integration lands.
        </p>
      ) : null}
    </div>
  );
}
