"use client";

import { useEffect, useMemo, useState } from "react";
import StatCard from "@/components/StatCard";
import SourceBadge from "@/components/SourceBadge";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import Collapsible from "@/components/Collapsible";
import Sparkline from "@/components/charts/Sparkline";
import Gauge from "@/components/charts/Gauge";
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

  // Earnings aggregated over the selected period's months.
  const periodIdx = period.months.map(monthIdx);
  const periodValues = periodIdx.map((i) => actualsArr[i]);
  const periodActuals = periodValues.filter((v): v is number => v != null);
  const periodEarnings = periodActuals.length ? periodActuals.reduce((a, b) => a + b, 0) : null;
  const avgPerMonth = periodActuals.length ? Math.round(periodEarnings! / periodActuals.length) : null;
  const bestVal = periodActuals.length ? Math.max(...periodActuals) : null;
  const bestLabel = bestVal != null ? MONTH_LABELS[actualsArr.findIndex((v) => v === bestVal)] : null;

  const pipelineRentPcm = stats ? stats.pipeline.reduce((sum, r) => sum + (r.rentPcm || 0), 0) : 0;

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
    <div className="space-y-5">
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
        <div className="card accent-soft-bg border-red-100 p-4 text-[13px]">
          <span className="font-semibold accent-text">Your stats profile isn&apos;t linked yet.</span>{" "}
          <span className="text-ink">
            Ask the admin to link your account to your agent profile — your earnings, funnel and
            pipeline will appear here as soon as that&apos;s done.
          </span>
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

      {loading ? (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="card h-44 animate-pulse" />
            <div className="card h-44 animate-pulse" />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card h-28 animate-pulse" />
            ))}
          </div>
        </div>
      ) : null}

      {!loading && stats ? (
        <>
          {/* ---- HERO: earnings YTD + this month ---- */}
          <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="enter enter-up card p-6" style={enterAt(900)}>
              <div className="flex items-start justify-between gap-3">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                  Earnings · {period.label}
                </div>
                <SourceBadge source="snapshot" asOf={SNAP} note="Partner net income (exc VAT) from the TLE Business Dashboard snapshot." />
              </div>
              <div className="mt-1 flex flex-wrap items-end gap-x-6 gap-y-2">
                <div className="stat-value stat-value--big">{periodEarnings != null ? formatGBP(periodEarnings) : "—"}</div>
                <div className="pb-1">
                  <Sparkline values={periodValues} />
                </div>
              </div>
              {periodEarnings == null && period.key === "this-month" ? (
                <p className="mt-2 text-[13px] text-muted">
                  {monthLabel(ANCHOR).split(" ")[0]} is still in progress — your earned figure lands at
                  month-end. Your target and pipeline are below.
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
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

            {(() => {
              const managed = stats.portfolio.managed.value ?? 0;
              const onMarket = stats.funnel.listings?.value ?? 0;
              const letAgreed = stats.funnel.pipeline?.value ?? 0;
              const total = managed + onMarket + letAgreed || 1;
              const rentRoll = stats.portfolio.rentRoll.value;
              const estFees = rentRoll != null ? rentRoll * MGMT_FEE_RATE : null;
              const seg = [
                { label: "Managed", value: managed, color: "#e31f36" },
                { label: "On market", value: onMarket, color: "#111827" },
                { label: "Let agreed", value: letAgreed, color: "#9ca3af" },
              ];
              return (
                <div className="enter enter-right card flex flex-col p-6" style={enterAt(1000)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                      Your portfolio
                    </div>
                    <SourceBadge
                      source={stats.portfolio.managed.source}
                      note={stats.portfolio.managed.note}
                      asOf={stats.portfolio.managed.asOf}
                    />
                  </div>
                  <div className="mt-1 flex items-end gap-3">
                    <div className="stat-value stat-value--big">
                      {stats.portfolio.managed.value != null ? formatNum(stats.portfolio.managed.value) : "—"}
                    </div>
                    <div className="pb-2 text-[12px] leading-tight text-muted">
                      managed
                      <br />
                      properties
                    </div>
                  </div>

                  {/* composition bar */}
                  <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-page">
                    {seg.map((s) =>
                      s.value > 0 ? (
                        <div
                          key={s.label}
                          style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
                          title={`${s.label}: ${s.value}`}
                        />
                      ) : null
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    {seg.map((s) => (
                      <span key={s.label} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
                        <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                        {s.label} <span className="font-semibold text-ink tnum">{s.value}</span>
                      </span>
                    ))}
                  </div>

                  {/* rent roll + estimated fees */}
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
                    <div>
                      <div className="stat-value text-[20px]">{stats.portfolio.rentRoll.display ?? "—"}</div>
                      <div className="mt-0.5 text-[11px] text-muted">Rent roll / month</div>
                    </div>
                    <div>
                      <div className="stat-value text-[20px]">{estFees != null ? formatGBP(estFees) : "—"}</div>
                      <div
                        className="mt-0.5 text-[11px] text-muted"
                        title="Estimated at ~9% of rent roll — the actual management fee and your share are confirmed with head office."
                      >
                        Est. fees / month · ~9%
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>

          {/* ---- THE BASICS ---- four boxes, each flowing up on its own beat */}
          <section>
            <h2
              className="enter enter-up mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted"
              style={enterAt(1100)}
            >
              This month · {monthLabel(ANCHOR)}
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="enter enter-up" style={enterAt(1180)}>
                <StatCard label="Market appraisals" stat={stats.funnel.marketAppraisals} />
              </div>
              <div className="enter enter-up" style={enterAt(1255)}>
                <StatCard label="Listings" stat={stats.funnel.listings} />
              </div>
              <div className="enter enter-up" style={enterAt(1330)}>
                <StatCard
                  label="Move-ins"
                  stat={snapStat(stats.moveIns.length, "From your move-in list", formatNum(stats.moveIns.length))}
                />
              </div>
              {/* Pipeline: prefer the live REX count (let-agreed) over the snapshot rows. */}
              <div className="enter enter-up" style={enterAt(1405)}>
                {stats.funnel.pipeline?.value != null ? (
                  <StatCard label="Pipeline" stat={stats.funnel.pipeline} sub="Let agreed, awaiting completion" />
                ) : (
                  <StatCard
                    label="Pipeline"
                    stat={snapStat(stats.pipeline.length, "Forward pipeline properties", formatNum(stats.pipeline.length))}
                    sub={pipelineRentPcm > 0 ? `${formatGBP(pipelineRentPcm)} pcm` : undefined}
                  />
                )}
              </div>
            </div>
          </section>

          {/* ---- INTERACTIVE FORECAST BUILDER ---- fades in */}
          <div className="enter enter-fade" style={enterAt(1520)}>
            <ForecastBuilder
              monthKeys={MONTH_KEYS}
              monthLabels={MONTH_LABELS}
              actualsNetIncome={actualsArr}
              currentMonthIndex={monthIdx(ANCHOR)}
              savedForecasts={forecastHistory}
              currentManaged={managed}
              avgFeePerProperty={avgFeePerProperty}
              onSaved={() => {}}
            />
          </div>

          {/* ---- CONVERSION RATES ---- pops in after the builder */}
          {c ? (
            <section className="enter enter-pop card p-5 sm:p-6" style={enterAt(1700)}>
              <div className="flex items-center justify-between">
                <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Conversion rates</h2>
                <SourceBadge source="snapshot" asOf={SNAP} note="Derived from your sales funnel in the TLE Business Dashboard snapshot." />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <Gauge label="Lead → MA" pct={c.leadToMa.value} />
                <Gauge label="MA → Listing" pct={c.maToListing.value} />
                <Gauge label="Listing → Move-in" pct={c.listingToMoveIn.value} />
              </div>
              {c.leadToMa.value == null && c.maToListing.value == null && c.listingToMoveIn.value == null ? (
                <p className="mt-3 text-center text-[13px] text-muted">
                  Conversion rates appear once you&apos;ve got appraisals and listings recorded this month.
                </p>
              ) : null}
            </section>
          ) : null}

          {/* ---- DETAIL (progressive disclosure) ---- last to arrive */}
          <section className="enter enter-pop space-y-3" style={enterAt(1820)}>
            <Collapsible title={`My move-ins · ${monthLabel(ANCHOR)}`} badge={stats.moveIns.length}>
              {stats.moveIns.length ? (
                <DataTable columns={moveInColumns} rows={stats.moveIns as Rowify<MoveInRow>[]} compact />
              ) : (
                <p className="text-[13px] text-muted">No move-ins recorded for you this month yet.</p>
              )}
            </Collapsible>

            <Collapsible title="My pipeline" badge={stats.pipeline.length}>
              {stats.pipeline.length ? (
                <DataTable columns={pipelineColumns} rows={stats.pipeline as Rowify<PipelineRow>[]} compact />
              ) : (
                <p className="text-[13px] text-muted">Nothing in your forward pipeline right now.</p>
              )}
            </Collapsible>

            <Collapsible
              title="Full funnel & compliance"
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
