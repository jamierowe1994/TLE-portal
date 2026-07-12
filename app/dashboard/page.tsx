"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import StatCard from "@/components/StatCard";
import SourceBadge from "@/components/SourceBadge";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import Collapsible from "@/components/Collapsible";
import Sparkline from "@/components/charts/Sparkline";
import Gauge from "@/components/charts/Gauge";
import ForecastChart from "@/components/charts/ForecastChart";
import PeriodPicker, { type ResolvedPeriod, resolvePreset } from "@/components/PeriodPicker";
import { PresentButton } from "@/components/PresentMode";
import { getUser } from "@/lib/session";
import { formatGBP, formatNum, monthLabel } from "@/lib/format";
import type {
  ConversionStats,
  FunnelStats,
  StatValue,
  UserProfile,
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
  forecast: {
    gciTarget: number | null;
    moveInsTarget: number | null;
    maTarget: number | null;
    notes?: string;
  } | null;
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

/* ---------------------------------- page ---------------------------------- */

export default function MyDashboardPage() {
  const [period, setPeriod] = useState<ResolvedPeriod>(() => resolvePreset("this-month"));
  const forecastMonth = period.forecastMonth;
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [actuals, setActuals] = useState<Record<string, number | null>>({});
  const [savedTarget, setSavedTarget] = useState<number | null>(null);
  const [targetDraft, setTargetDraft] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setUser(getUser());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Funnel/basics are the current-month snapshot; the forecast (target +
    // monthly actuals) is loaded for whichever month the period is anchored to.
    const statsReq = fetch(`/api/my/stats?month=${ANCHOR}`, { cache: "no-store" }).then(
      async (res) => {
        if (!res.ok) throw new Error("Couldn't load your stats.");
        return (await res.json()) as StatsResponse;
      }
    );

    const forecastReq = fetch(`/api/my/forecast?month=${forecastMonth}`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as ForecastResponse) : null))
      .catch(() => null);

    Promise.all([statsReq, forecastReq])
      .then(([s, f]) => {
        if (cancelled) return;
        setStats(s);
        setActuals(f?.actuals ?? {});
        const t = f?.forecast?.gciTarget ?? null;
        setSavedTarget(t);
        setTargetDraft(t);
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
  }, [forecastMonth, reloadKey]);

  /* ------------------------------ derived data ------------------------------ */

  const actualsArr = useMemo(() => MONTH_KEYS.map((k) => actuals[k] ?? null), [actuals]);
  const targetIndex = monthIdx(forecastMonth);

  // Earnings aggregated over the selected period's months.
  const periodIdx = period.months.map(monthIdx);
  const periodValues = periodIdx.map((i) => actualsArr[i]);
  const periodActuals = periodValues.filter((v): v is number => v != null);
  const periodEarnings = periodActuals.length ? periodActuals.reduce((a, b) => a + b, 0) : null;
  const avgPerMonth = periodActuals.length ? Math.round(periodEarnings! / periodActuals.length) : null;
  const bestVal = periodActuals.length ? Math.max(...periodActuals) : null;
  const bestLabel = bestVal != null ? MONTH_LABELS[actualsArr.findIndex((v) => v === bestVal)] : null;
  const highlightRange: [number, number] | null = periodIdx.length
    ? [Math.min(...periodIdx), Math.max(...periodIdx)]
    : null;

  const pipelineRentPcm = stats ? stats.pipeline.reduce((sum, r) => sum + (r.rentPcm || 0), 0) : 0;

  /* ------------------------------ save forecast ----------------------------- */

  async function saveTarget(value: number | null) {
    if (value === savedTarget) return;
    setSavedTarget(value);
    try {
      const res = await fetch("/api/my/forecast", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: forecastMonth, gciTarget: value }),
      });
      if (res.ok) {
        setFlash(true);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(false), 1600);
      }
    } catch {
      /* keep the optimistic value; the agent can retry by editing again */
    }
  }

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
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">My Dashboard</h1>
          <p className="mt-0.5 text-[13px] text-muted">
            {user?.name ? `${user.name} · ` : ""}
            {monthLabel(ANCHOR)}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <PresentButton />
        </div>
      </div>

      {/* Period selector — drives the earnings view below */}
      <div className="hide-when-presenting">
        <PeriodPicker value={period} onChange={setPeriod} />
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
            <div className="card p-6">
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
                <div className="card flex flex-col p-6">
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

          {/* ---- THE BASICS ---- */}
          <section>
            <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
              This month · {monthLabel(ANCHOR)}
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Market appraisals" stat={stats.funnel.marketAppraisals} />
              <StatCard label="Listings" stat={stats.funnel.listings} />
              <StatCard
                label="Move-ins"
                stat={snapStat(stats.moveIns.length, "From your move-in list", formatNum(stats.moveIns.length))}
              />
              {/* Pipeline: prefer the live REX count (let-agreed) over the snapshot rows. */}
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
          </section>

          {/* ---- LIVE FORECAST GRAPH ---- */}
          <section className="card p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                Your year — earnings vs forecast
              </h2>
              {flash ? (
                <span className="fade-up rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                  Saved ✓
                </span>
              ) : null}
              <Link
                href="/dashboard/forecast"
                className="hide-when-presenting ml-auto text-[13px] font-medium accent-text underline-offset-2 hover:underline"
              >
                Full forecast →
              </Link>
            </div>

            <p className="mt-1 text-[13px] text-muted">
              Solid line is what you&apos;ve earned each month; the shaded band is{" "}
              <span className="font-medium text-ink">{period.label.toLowerCase()}</span>. Drag the{" "}
              <span className="font-medium accent-text">red handle</span> — or type below — to set your
              target for {monthLabel(forecastMonth)} and watch the line move.
            </p>

            <div className="mt-3">
              <ForecastChart
                labels={MONTH_LABELS}
                actuals={actualsArr}
                targetIndex={targetIndex}
                target={targetDraft}
                onChange={(v) => setTargetDraft(v)}
                onCommit={(v) => saveTarget(v)}
                highlightRange={highlightRange}
                format={(nn) => (nn >= 1000 ? `£${(nn / 1000).toFixed(nn % 1000 === 0 ? 0 : 1)}k` : `£${Math.round(nn)}`)}
              />
            </div>

            {/* Inline target editor + readouts */}
            <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  My target for {monthLabel(forecastMonth)}
                </span>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="text-lg font-semibold text-muted">£</span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    inputMode="numeric"
                    value={targetDraft ?? ""}
                    placeholder="e.g. 3000"
                    onChange={(e) => setTargetDraft(e.target.value === "" ? null : Math.max(0, Number(e.target.value)))}
                    onBlur={() => saveTarget(targetDraft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    className="hairline w-full max-w-[160px] rounded-lg border border-line bg-white px-3 py-2 text-lg font-semibold tnum outline-none transition focus:border-accent"
                  />
                </div>
              </label>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Avg / month</div>
                <div className="stat-value mt-1.5 text-[22px]">{avgPerMonth != null ? formatGBP(avgPerMonth) : "—"}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {period.label} · {periodActuals.length} month{periodActuals.length === 1 ? "" : "s"}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Best month</div>
                <div className="stat-value mt-1.5 text-[22px]">{bestVal != null ? formatGBP(bestVal) : "—"}</div>
                <div className="mt-0.5 text-xs text-muted">{bestLabel ? `${bestLabel} 2026` : "—"}</div>
              </div>
            </div>
          </section>

          {/* ---- CONVERSION RATES ---- */}
          {c ? (
            <section className="card p-5 sm:p-6">
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

          {/* ---- DETAIL (progressive disclosure) ---- */}
          <section className="space-y-3">
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
