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
import { PresentButton } from "@/components/PresentMode";
import { getUser } from "@/lib/session";
import { formatGBP, formatNum, monthLabel, currentMonth } from "@/lib/format";
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
  moveIns: MoveInRow[];
  pipeline: PipelineRow[];
  compliance: ComplianceAgentRow | null;
  netIncomeYtd: PartnerNetIncomeRow | null;
}

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
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_KEYS = MONTH_LABELS.map((_, i) => `${YEAR}-${String(i + 1).padStart(2, "0")}`);
const SNAP = "2026-07-11";

function monthOptions(): string[] {
  const end = currentMonth() > "2026-07" ? currentMonth() : "2026-07";
  const out: string[] = [];
  for (const key of MONTH_KEYS) {
    out.push(key);
    if (key === end) break;
  }
  return out.reverse();
}

function snapStat(value: number | null, note: string, display?: string): StatValue {
  return { value, display, source: "snapshot", asOf: SNAP, note };
}

/* ---------------------------------- page ---------------------------------- */

export default function MyDashboardPage() {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0]);
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

    const statsReq = fetch(`/api/my/stats?month=${month}`, { cache: "no-store" }).then(
      async (res) => {
        if (!res.ok) throw new Error("Couldn't load your stats.");
        return (await res.json()) as StatsResponse;
      }
    );

    const forecastReq = fetch(`/api/my/forecast?month=${month}`, { cache: "no-store" })
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
  }, [month, reloadKey]);

  /* ------------------------------ derived data ------------------------------ */

  const actualsArr = useMemo(() => MONTH_KEYS.map((k) => actuals[k] ?? null), [actuals]);
  const targetIndex = Number(month.slice(5, 7)) - 1;

  const actualMonths = actualsArr.filter((v): v is number => v != null);
  const ytdTotal = stats?.netIncomeYtd?.ytdTotal ?? (actualMonths.length ? actualMonths.reduce((a, b) => a + b, 0) : null);
  const avgPerMonth = actualMonths.length ? Math.round(actualMonths.reduce((a, b) => a + b, 0) / actualMonths.length) : null;
  const bestVal = actualMonths.length ? Math.max(...actualMonths) : null;
  const bestLabel = bestVal != null ? MONTH_LABELS[actualsArr.findIndex((v) => v === bestVal)] : null;

  const pipelineRentPcm = stats ? stats.pipeline.reduce((sum, r) => sum + (r.rentPcm || 0), 0) : 0;

  /* ------------------------------ save forecast ----------------------------- */

  async function saveTarget(value: number | null) {
    if (value === savedTarget) return;
    setSavedTarget(value);
    try {
      const res = await fetch("/api/my/forecast", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, gciTarget: value }),
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
            {monthLabel(month)}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="hide-when-presenting rounded-lg border border-line bg-card px-3 py-2 text-[13px] font-medium outline-none transition focus:border-gray-400"
            aria-label="Month"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <PresentButton />
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
            <div className="card p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                  Earnings · year to date
                </div>
                <SourceBadge source="snapshot" asOf={SNAP} note="Partner net income (exc VAT) from the TLE Business Dashboard snapshot." />
              </div>
              <div className="mt-1 flex flex-wrap items-end gap-x-6 gap-y-2">
                <div className="stat-value stat-value--big">{ytdTotal != null ? formatGBP(ytdTotal) : "—"}</div>
                <div className="pb-1">
                  <Sparkline values={actualsArr} />
                </div>
              </div>
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
                  {actualMonths.length} month{actualMonths.length === 1 ? "" : "s"} tracked
                </span>
              </div>
            </div>

            <div className="card flex flex-col justify-between p-6">
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                  Your target · {monthLabel(month)}
                </div>
                <div className="stat-value mt-1">{savedTarget != null ? formatGBP(savedTarget) : "—"}</div>
                <div className="mt-1 text-xs text-muted">
                  {savedTarget != null ? "Set by you — drag the graph to change it" : "Set one on the graph below"}
                </div>
              </div>
              <div className="mt-4 flex items-end gap-6 border-t border-line pt-4">
                <div>
                  <div className="stat-value text-[22px]">{formatNum(stats.pipeline.length)}</div>
                  <div className="mt-0.5 text-xs text-muted">In your pipeline</div>
                </div>
                <div>
                  <div className="stat-value text-[22px]">{pipelineRentPcm > 0 ? formatGBP(pipelineRentPcm) : "—"}</div>
                  <div className="mt-0.5 text-xs text-muted">Rent pcm in play</div>
                </div>
              </div>
            </div>
          </section>

          {/* ---- THE BASICS ---- */}
          <section>
            <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
              This month · {monthLabel(month)}
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Market appraisals" stat={stats.funnel.marketAppraisals} />
              <StatCard label="Listings" stat={stats.funnel.listings} />
              <StatCard
                label="Move-ins"
                stat={snapStat(stats.moveIns.length, "From your move-in list", formatNum(stats.moveIns.length))}
              />
              <StatCard
                label="Pipeline"
                stat={snapStat(stats.pipeline.length, "Forward pipeline properties", formatNum(stats.pipeline.length))}
                sub={pipelineRentPcm > 0 ? `${formatGBP(pipelineRentPcm)} pcm` : undefined}
              />
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
              Solid line is what you&apos;ve earned each month. Drag the{" "}
              <span className="font-medium accent-text">red handle</span> — or type below — to set your
              target for {monthLabel(month)} and watch the line move.
            </p>

            <div className="mt-3">
              <ForecastChart
                labels={MONTH_LABELS}
                actuals={actualsArr}
                targetIndex={targetIndex}
                target={targetDraft}
                onChange={(v) => setTargetDraft(v)}
                onCommit={(v) => saveTarget(v)}
                format={(nn) => (nn >= 1000 ? `£${(nn / 1000).toFixed(nn % 1000 === 0 ? 0 : 1)}k` : `£${Math.round(nn)}`)}
              />
            </div>

            {/* Inline target editor + readouts */}
            <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  My target for {monthLabel(month)}
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
                    className="w-full max-w-[160px] rounded-lg border border-line bg-white px-3 py-2 text-lg font-semibold tnum outline-none transition focus:border-accent"
                  />
                </div>
              </label>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Avg / month YTD</div>
                <div className="stat-value mt-1.5 text-[22px]">{avgPerMonth != null ? formatGBP(avgPerMonth) : "—"}</div>
                <div className="mt-0.5 text-xs text-muted">Across {actualMonths.length} months</div>
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
            <Collapsible title={`My move-ins · ${monthLabel(month)}`} badge={stats.moveIns.length}>
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
