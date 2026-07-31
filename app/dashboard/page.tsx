"use client";

import { useEffect, useMemo, useState } from "react";
import StatCard from "@/components/StatCard";
import SourceBadge from "@/components/SourceBadge";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import Collapsible from "@/components/Collapsible";
import Sparkline from "@/components/charts/Sparkline";
import Gauge from "@/components/charts/Gauge";
import DoodleIcon from "@/components/DoodleIcon";
import Loader from "@/components/Loader";
import ForecastBuilder, { type SavedForecast } from "@/components/ForecastBuilder";
import PeriodPicker, { type ResolvedPeriod, resolvePreset } from "@/components/PeriodPicker";
import { formatGBP, formatNum, monthLabel } from "@/lib/format";
import type {
  ConversionStats,
  FunnelStats,
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

type Rowify<T> = T & Record<string, unknown>;

interface StatsResponse {
  month: string;
  agentKey: string | null;
  funnel: FunnelStats;
  conversions: ConversionStats;
  portfolio: { managed: StatValue; rentRoll: StatValue };
  portfolioDetail: PortfolioRow | null;
  moveIns: MoveInRow[];
  pipeline: PipelineRow[];
  compliance: ComplianceAgentRow | null;
  netIncomeYtd: PartnerNetIncomeRow | null;
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
const ANCHOR = "2026-07"; // current month for the funnel snapshot
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_KEYS = MONTH_LABELS.map((_, i) => `${YEAR}-${String(i + 1).padStart(2, "0")}`);
const SNAP = "2026-07-11";
const monthIdx = (m: string) => Number(m.slice(5, 7)) - 1;

function snapStat(value: number | null, note: string, display?: string): StatValue {
  return { value, display, source: "snapshot", asOf: SNAP, note };
}

// Entrance choreography — each piece lands on its own beat so the dashboard
// builds itself as you arrive. Delays are relative to this content mounting
// (which is after the greeting has already had its moment).
const enterAt = (ms: number) =>
  ({ "--enter-delay": `${ms}ms` }) as React.CSSProperties;

/* ---------------------------------- page ---------------------------------- */

export default function MyDashboardPage() {
  const [period, setPeriod] = useState<ResolvedPeriod>(() => resolvePreset("this-month"));
  // Live commission from PayProp for the current month — the snapshot's
  // stand-in until it lands, since the walk runs in the background.
  const [liveEarnings, setLiveEarnings] = useState<{
    earned: number;
    matched: boolean;
    byCategory: Array<{ category: string; amount: number }>;
  } | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [actuals, setActuals] = useState<Record<string, number | null>>({});
  const [forecastHistory, setForecastHistory] = useState<Record<string, SavedForecast>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Funnel/basics are the current-month snapshot; the forecast GET returns the
    // agent's whole forecast history + monthly actuals (both month-agnostic).
    const statsReq = fetch(`/api/my/stats?month=${ANCHOR}`, { cache: "no-store" }).then(
      async (res) => {
        if (!res.ok) throw new Error("Couldn't load your stats.");
        return (await res.json()) as StatsResponse;
      }
    );

    const forecastReq = fetch(`/api/my/forecast?month=${ANCHOR}`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as ForecastResponse) : null))
      .catch(() => null);

    Promise.all([statsReq, forecastReq])
      .then(([s, f]) => {
        if (cancelled) return;
        setStats(s);
        setActuals(f?.actuals ?? {});
        const hist: Record<string, SavedForecast> = {};
        for (const row of f?.history ?? []) {
          hist[row.month] = { gciTarget: row.gciTarget ?? null, portfolioTarget: row.portfolioTarget ?? null };
        }
        setForecastHistory(hist);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Something went wrong.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  /* ------------------------------ derived data ------------------------------ */

  const actualsArr = useMemo(() => MONTH_KEYS.map((k) => actuals[k] ?? null), [actuals]);

  // Forecast-builder inputs: avg estimated management fee per managed property.
  const managed = stats?.portfolio.managed.value ?? 0;
  const rentRoll = stats?.portfolio.rentRoll.value ?? 0;
  const avgFeePerProperty = managed > 0 ? (rentRoll * MGMT_FEE_RATE) / managed : 0;

  // PayProp gathers in the background, so ask again shortly after the first
  // miss rather than leaving the card on the snapshot for the whole session.
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const ask = () => {
      fetch(`/api/my/earnings?month=${ANCHOR}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { earnings?: { earned: number; matched: boolean; byCategory: Array<{ category: string; amount: number }> } | null; refreshing?: boolean }) => {
          if (cancelled) return;
          if (d.earnings) setLiveEarnings(d.earnings);
          else if (tries++ < 40) setTimeout(ask, 5000);
        })
        .catch(() => {});
    };
    ask();
    return () => {
      cancelled = true;
    };
  }, []);

  // Earnings aggregated over the selected period's months.
  const periodIdx = period.months.map(monthIdx);
  const periodValues = periodIdx.map((i) => actualsArr[i]);
  const periodActuals = periodValues.filter((v): v is number => v != null);
  const snapshotEarnings = periodActuals.length ? periodActuals.reduce((a, b) => a + b, 0) : null;
  // This month comes straight from PayProp once it's there; other periods
  // still read the snapshot's monthly actuals.
  const useLive = period.key === "this-month" && liveEarnings?.matched === true;
  const periodEarnings = useLive ? liveEarnings!.earned : snapshotEarnings;
  const avgPerMonth = periodActuals.length ? Math.round(periodEarnings! / periodActuals.length) : null;
  const bestVal = periodActuals.length ? Math.max(...periodActuals) : null;
  const bestLabel = bestVal != null ? MONTH_LABELS[actualsArr.findIndex((v) => v === bestVal)] : null;

  /* --------------------------------- tables --------------------------------- */

  const moveInColumns: DataTableColumn<Rowify<MoveInRow>>[] = [
    { key: "property", label: "Property" },
    { key: "moveInDate", label: "Move-in" },
    { key: "letType", label: "Let type" },
    { key: "serviceLevel", label: "Service level" },
    { key: "rentPcm", label: "Rent pcm", align: "right", render: (r) => formatGBP(r.rentPcm) },
    { key: "setupFee", label: "Setup fee", align: "right", render: (r) => formatGBP(r.setupFee) },
    { key: "twelveMonthValue", label: "12m value", align: "right", render: (r) => formatGBP(r.twelveMonthValue) },
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

  return (
    // outline-cards: the dashboard experiment — boxes as outlines on the grey
    // rather than filled white (globals.css).
    <div className="outline-cards space-y-5">
      {/* Period selector — drives the earnings view below.
          Slides in from behind the nav rail. */}
      <div
        className="enter enter-left flex flex-wrap items-center gap-3"
        style={enterAt(800)}
      >
        <h1 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Your month · {monthLabel(ANCHOR)}
        </h1>
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
          {/* ---- HERO: earnings + portfolio mix share ONE outlined box, split
               by a centre line that stops short of the edges ---- */}
          <section className="enter enter-up card grid lg:grid-cols-[1fr_1.3fr]" style={enterAt(900)}>
            <div className="flex h-full flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                  <DoodleIcon name="wallet" size={16} className="text-accent" />
                  Earnings · {period.label}
                </div>
                {useLive ? (
                  <SourceBadge
                    source="live-payprop"
                    note="Your commission this month, live from PayProp — management and set-up fees paid to you."
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
                    <div className="stat-value text-[17px]" style={{ fontWeight: 300 }}>
                      {periodEarnings != null ? formatGBP(periodEarnings) : "—"}
                    </div>
                    <div className="pb-1">
                      <Sparkline values={periodValues} />
                    </div>
                  </div>
                  {periodEarnings == null && period.key === "this-month" ? (
                    <p className="mt-1.5 text-[12px] text-muted">
                      {monthLabel(ANCHOR).split(" ")[0]} is still in progress — your earned figure lands at
                      month-end.
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-auto flex flex-wrap gap-2 pt-3 text-[12px]">
                {avgPerMonth != null ? (
                  <span className="rounded-full bg-page px-2.5 py-1 text-muted">
                    Avg <span className="font-semibold text-ink tnum">{formatGBP(avgPerMonth)}</span>/mo
                  </span>
                ) : null}
                {bestVal != null ? (
                  <span className="rounded-full bg-page px-2.5 py-1 text-muted">
                    Best <span className="font-semibold text-ink tnum">{formatGBP(bestVal)}</span>
                    {bestLabel ? ` · ${bestLabel}` : ""}
                  </span>
                ) : null}
                <span className="rounded-full bg-page px-2.5 py-1 text-muted">
                  {periodActuals.length} month{periodActuals.length === 1 ? "" : "s"} of data
                </span>
              </div>
            </div>

            {/* stacked on mobile: a short horizontal rule instead */}
            <div className="mx-6 border-t border-black/[0.08] lg:hidden" />

            {(() => {
              const detail = stats.portfolioDetail;
              const fullyManaged = detail?.managed ?? stats.portfolio.managed.value ?? 0;
              const letOnly = detail?.letOnly ?? 0;
              const onMarket = stats.funnel.listings?.value ?? 0;
              const letAgreed = stats.funnel.pipeline?.value ?? 0;
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
                    <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                      <DoodleIcon name="pie" size={16} className="text-accent" />
                      Your portfolio mix
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
                      className="pointer-events-none absolute -bottom-[7px] right-0 max-w-[62%]"
                    />
                  </div>

                  {/* rent roll underneath, with the supporting stats */}
                  <div className="mt-auto grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4">
                    <div>
                      <div className="stat-value text-[17px]" style={{ fontWeight: 300 }}>{stats.portfolio.rentRoll.display ?? "—"}</div>
                      <div className="mt-0.5 text-[11px] text-muted">Rent roll / month</div>
                    </div>
                    <div>
                      <div className="stat-value text-[17px]" style={{ fontWeight: 300 }}>{estFees != null ? formatGBP(estFees) : "—"}</div>
                      <div
                        className="mt-0.5 text-[11px] text-muted"
                        title="Estimated at ~9% of rent roll — the actual management fee and your share are confirmed with head office."
                      >
                        Est. fees · ~9%
                      </div>
                    </div>
                    <div>
                      <div className="stat-value text-[17px]" style={{ fontWeight: 300 }}>
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
                This month · {monthLabel(ANCHOR)}
              </h2>
              <div className="relative mt-4 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/illustrations/notioly/moving.svg"
                  alt=""
                  aria-hidden
                  className="pointer-events-none absolute -top-9 right-0 hidden h-[105px] lg:block"
                />
                {(
                  [
                    ["Market appraisals", stats.funnel.marketAppraisals],
                    ["Listings", stats.funnel.listings],
                    ["Move-ins", snapStat(stats.moveIns.length, "From your move-in list", formatNum(stats.moveIns.length))],
                    // Pipeline: prefer the live REX count (let-agreed) over the snapshot rows.
                    [
                      "Pipeline",
                      stats.funnel.pipeline?.value != null
                        ? stats.funnel.pipeline
                        : snapStat(stats.pipeline.length, "Forward pipeline properties", formatNum(stats.pipeline.length)),
                    ],
                  ] as const
                ).map(([label, stat]) => (
                  <div key={label}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
                      <SourceBadge source={stat.source} note={stat.note} asOf={stat.asOf} compact />
                    </div>
                    <div className="stat-value mt-1 text-[24px]">
                      {stat.display ?? (stat.value == null ? "—" : formatNum(stat.value))}
                    </div>
                  </div>
                ))}
              </div>
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
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                    <DoodleIcon name="target" size={16} />
                    Conversion rates
                  </h2>
                  <SourceBadge source="snapshot" asOf={SNAP} note="Derived from your sales funnel in the TLE Business Dashboard snapshot." />
                </div>
                <div className="my-auto grid grid-cols-3 gap-2 py-4">
                  <Gauge label="Lead → MA" pct={c.leadToMa.value} />
                  <Gauge label="MA → Listing" pct={c.maToListing.value} />
                  <Gauge label="Listing → Move-in" pct={c.listingToMoveIn.value} />
                </div>
              </div>
            ) : null}
            <Collapsible title={`My move-ins · ${monthLabel(ANCHOR)}`} badge={stats.moveIns.length} icon="key">
              {stats.moveIns.length ? (
                <DataTable columns={moveInColumns} rows={stats.moveIns as Rowify<MoveInRow>[]} compact />
              ) : (
                <p className="text-[13px] text-muted">No move-ins recorded for you this month yet.</p>
              )}
            </Collapsible>

            <Collapsible title="My pipeline" badge={stats.pipeline.length} icon="list">
              {stats.pipeline.length ? (
                <DataTable columns={pipelineColumns} rows={stats.pipeline as Rowify<PipelineRow>[]} compact />
              ) : (
                <p className="text-[13px] text-muted">Nothing in your forward pipeline right now.</p>
              )}
            </Collapsible>

            <Collapsible
              title="Full funnel & compliance"
              icon="analytics"
              badge={stats.compliance ? `${stats.compliance.overdue} overdue` : undefined}
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="Viewings" stat={stats.funnel.viewings} />
                <StatCard label="Applications" stat={stats.funnel.applications} />
                {stats.funnel.liveListings ? <StatCard label="Live listings" stat={stats.funnel.liveListings} /> : null}
                {stats.conversions?.gciPerMoveIn ? (
                  <StatCard label="GCI per move-in" stat={stats.conversions.gciPerMoveIn} />
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
                  <div className="ml-auto self-start">
                    <SourceBadge source="snapshot" asOf={SNAP} note="Compliance counts from REX PM via the snapshot." />
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
