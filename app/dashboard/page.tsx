"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import StatCard from "@/components/StatCard";
import SourceBadge from "@/components/SourceBadge";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import { PresentButton } from "@/components/PresentMode";
import { getUser } from "@/lib/session";
import {
  formatGBP,
  formatNum,
  monthLabel,
  currentMonth,
  daysElapsedFraction,
} from "@/lib/format";
import type {
  AgentForecast,
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

// DataTable rows must satisfy Record<string, unknown>; the seed-types
// interfaces don't carry an index signature, so widen them for the table.
type Rowify<T> = T & Record<string, unknown>;

// My Dashboard — the signed-in agent's month at a glance. Every figure is a
// StatValue with a source badge (live / manual / snapshot / derived) so the
// team can work unmatched stats through one by one.

/* ----------------------------- response shapes ---------------------------- */

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

interface MetaResponse {
  configured: boolean;
  snapshot?: {
    impressions: number;
    clicks: number;
    spend: number;
    leads: number;
    cpl: number | null;
    datePreset: string;
  };
  creatives?: Array<{ adName: string; imageUrl: string }>;
  error?: string;
}

/* --------------------------------- helpers -------------------------------- */

const EARLIEST_MONTH = "2026-01";

function monthOptions(): string[] {
  const end = currentMonth() > "2026-07" ? currentMonth() : "2026-07";
  const out: string[] = [];
  let y = Number(EARLIEST_MONTH.slice(0, 4));
  let m = Number(EARLIEST_MONTH.slice(5, 7));
  for (let i = 0; i < 36; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key === end) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out.reverse(); // newest first
}

function liveMetaStat(value: number | null, display?: string): StatValue {
  return {
    value,
    display,
    source: "live-meta",
    asOf: new Date().toISOString().slice(0, 10),
  };
}

/** Parse /api/my/forecast defensively — accepts { forecast } or a bare row. */
function parseForecast(data: unknown): AgentForecast | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const row = "forecast" in obj ? obj.forecast : obj;
  if (!row || typeof row !== "object") return null;
  if (!("gciTarget" in (row as Record<string, unknown>))) return null;
  return row as AgentForecast;
}

/* ---------------------------------- page ---------------------------------- */

export default function MyDashboardPage() {
  const months = useMemo(monthOptions, []);
  const [month, setMonth] = useState(months[0]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [forecast, setForecast] = useState<AgentForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [user, setUser] = useState<UserProfile | null>(null);

  // Read the cached user after mount only — avoids an SSR hydration mismatch.
  useEffect(() => {
    setUser(getUser());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const statsReq = fetch(`/api/my/stats?month=${month}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Couldn't load your stats.");
        return (await res.json()) as StatsResponse;
      });

    const metaReq = fetch("/api/my/meta", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as MetaResponse) : null))
      .catch(() => null);

    const forecastReq = fetch(`/api/my/forecast?month=${month}`, {
      cache: "no-store",
    })
      .then(async (res) => (res.ok ? parseForecast(await res.json()) : null))
      .catch(() => null);

    Promise.all([statsReq, metaReq, forecastReq])
      .then(([s, m, f]) => {
        if (cancelled) return;
        setStats(s);
        setMeta(m);
        setForecast(f);
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

  /* ------------------------- forecast vs actual maths ------------------------ */

  const actualGci = stats?.funnel.gci?.value ?? null;
  const fraction = daysElapsedFraction(month);
  const predicted =
    actualGci != null && fraction > 0 ? actualGci / fraction : null;
  const target = forecast?.gciTarget ?? null;
  const variance =
    predicted != null && target != null ? predicted - target : null;

  /* --------------------------------- tables --------------------------------- */

  const moveInColumns: DataTableColumn<Rowify<MoveInRow>>[] = [
    { key: "property", label: "Property" },
    { key: "moveInDate", label: "Move-in" },
    { key: "letType", label: "Let type" },
    { key: "serviceLevel", label: "Service level" },
    {
      key: "rentPcm",
      label: "Rent pcm",
      align: "right",
      render: (r) => formatGBP(r.rentPcm),
    },
    {
      key: "setupFee",
      label: "Setup fee",
      align: "right",
      render: (r) => formatGBP(r.setupFee),
    },
    {
      key: "monthlyMgmtFee",
      label: "Mgmt fee /mo",
      align: "right",
      render: (r) => formatGBP(r.monthlyMgmtFee),
    },
    {
      key: "twelveMonthValue",
      label: "12m value",
      align: "right",
      render: (r) => formatGBP(r.twelveMonthValue),
    },
  ];

  const pipelineColumns: DataTableColumn<Rowify<PipelineRow>>[] = [
    { key: "property", label: "Property" },
    { key: "expectedMoveIn", label: "Expected move-in" },
    { key: "status", label: "Status" },
    { key: "serviceLevel", label: "Service level" },
    {
      key: "rentPcm",
      label: "Rent pcm",
      align: "right",
      render: (r) => formatGBP(r.rentPcm),
    },
    {
      key: "period",
      label: "Period",
      render: (r) => (r.period === "july" ? "July" : "Aug–Sep"),
    },
  ];

  /* --------------------------------- render --------------------------------- */

  return (
    <div className="space-y-6">
      {/* Header: title, month picker, present button */}
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

      {/* No linked stats profile yet */}
      {!loading && stats && !stats.agentKey ? (
        <div className="card accent-soft-bg border-red-100 p-4 text-[13px]">
          <span className="font-semibold accent-text">
            Your stats profile isn&apos;t linked yet.
          </span>{" "}
          <span className="text-ink">
            Ask the admin to link your account to your agent profile — your
            funnel, move-ins and pipeline will appear here as soon as that&apos;s
            done.
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card h-28 animate-pulse p-5" />
          ))}
        </div>
      ) : null}

      {!loading && stats ? (
        <>
          {/* 1 — KPI row */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Market appraisals" stat={stats.funnel.marketAppraisals} />
            <StatCard label="Listings" stat={stats.funnel.listings} />
            <StatCard label="Viewings" stat={stats.funnel.viewings} />
            <StatCard label="Applications" stat={stats.funnel.applications} />
            <StatCard label="Move-ins" stat={stats.funnel.moveIns} />
            <StatCard label="Pipeline" stat={stats.funnel.pipeline} sub="Forward pipeline" />
          </section>

          {/* 2 — Conversions */}
          <section>
            <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
              Conversion rates
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Lead → MA" stat={stats.conversions.leadToMa} />
              <StatCard label="MA → Listing" stat={stats.conversions.maToListing} />
              <StatCard label="Listing → Move-in" stat={stats.conversions.listingToMoveIn} />
              {stats.conversions.gciPerMoveIn ? (
                <StatCard label="GCI per move-in" stat={stats.conversions.gciPerMoveIn} />
              ) : null}
            </div>
          </section>

          {/* 3 — My Live Ads strip */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
                My live ads{meta?.snapshot ? " · last 30 days" : ""}
              </h2>
              <Link
                href="/dashboard/ads"
                className="hide-when-presenting text-[13px] font-medium accent-text underline-offset-2 hover:underline"
              >
                View all ads →
              </Link>
            </div>
            {meta?.configured && meta.snapshot ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard
                  label="Spend"
                  stat={liveMetaStat(meta.snapshot.spend, formatGBP(meta.snapshot.spend))}
                />
                <StatCard label="Leads" stat={liveMetaStat(meta.snapshot.leads)} />
                <StatCard
                  label="Cost per lead"
                  stat={liveMetaStat(
                    meta.snapshot.cpl,
                    meta.snapshot.cpl != null ? formatGBP(meta.snapshot.cpl, true) : "—"
                  )}
                />
                <StatCard label="Impressions" stat={liveMetaStat(meta.snapshot.impressions)} />
              </div>
            ) : meta?.configured && meta.error ? (
              <div className="card p-5 text-[13px] text-muted">
                Couldn&apos;t reach Meta just now — your live ad figures will be
                back shortly. ({meta.error})
              </div>
            ) : (
              <div className="card p-5 text-[13px] text-muted">
                <span className="font-medium text-ink">
                  Your live ad figures aren&apos;t wired up yet.
                </span>{" "}
                The admin will link your Meta campaign to your account — spend,
                leads and cost-per-lead will then appear here automatically.
              </div>
            )}
          </section>

          {/* 4 — Forecast vs actual */}
          <section className="card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
                Forecast vs actual · {monthLabel(month)}
              </h2>
              {variance != null ? (
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold tnum ${
                    variance >= 0
                      ? "border-green-200 bg-green-50 text-green-700"
                      : "border-red-200 bg-red-50 text-red-700"
                  }`}
                >
                  {variance >= 0 ? "On track +" : "Behind −"}
                  {formatGBP(Math.abs(variance))}
                </span>
              ) : null}
              <Link
                href="/dashboard/forecast"
                className="hide-when-presenting ml-auto text-[13px] font-medium accent-text underline-offset-2 hover:underline"
              >
                {target != null ? "Edit forecast →" : "Set your forecast →"}
              </Link>
            </div>

            {target != null || actualGci != null ? (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Your GCI target
                  </div>
                  <div className="stat-value mt-1.5">{formatGBP(target)}</div>
                  <div className="mt-1 text-xs text-muted">Set by you on the Forecast page</div>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Actual GCI MTD
                    {stats.funnel.gci ? (
                      <SourceBadge
                        source={stats.funnel.gci.source}
                        note={stats.funnel.gci.note}
                        asOf={stats.funnel.gci.asOf}
                      />
                    ) : null}
                  </div>
                  <div className="stat-value mt-1.5">
                    {stats.funnel.gci?.display ?? formatGBP(actualGci)}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {Math.round(fraction * 100)}% of the month elapsed
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Predicted month-end
                  </div>
                  <div className="stat-value mt-1.5">{formatGBP(predicted)}</div>
                  <div className="mt-1 text-xs text-muted">
                    At your current run rate
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-[13px] text-muted">
                No target set for {monthLabel(month)} yet — set one on the
                Forecast page and this card will track you against it, with a
                predicted month-end figure at your current run rate.
              </p>
            )}
          </section>

          {/* 5 — Move-ins + pipeline tables */}
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div>
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
                My move-ins · July
              </h2>
              <DataTable
                columns={moveInColumns}
                rows={stats.moveIns as Rowify<MoveInRow>[]}
                compact
              />
            </div>
            <div>
              <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
                My pipeline
              </h2>
              <DataTable
                columns={pipelineColumns}
                rows={stats.pipeline as Rowify<PipelineRow>[]}
                compact
              />
            </div>
          </section>

          {/* 6 — Compliance + net income */}
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="card p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Compliance
              </div>
              {stats.compliance ? (
                <div className="mt-3 flex flex-wrap items-end gap-6">
                  <div>
                    <div
                      className={`stat-value ${
                        stats.compliance.overdue === 0
                          ? "text-green-600"
                          : stats.compliance.pctOverdue >= 50
                            ? "text-red-600"
                            : "text-amber-600"
                      }`}
                    >
                      {formatNum(stats.compliance.overdue)}
                    </div>
                    <div className="mt-1 text-xs text-muted">Overdue items</div>
                  </div>
                  <div>
                    <div className="stat-value">{formatNum(stats.compliance.upcoming)}</div>
                    <div className="mt-1 text-xs text-muted">Upcoming (60 days)</div>
                  </div>
                  <div>
                    <div className="stat-value">{formatNum(stats.compliance.total)}</div>
                    <div className="mt-1 text-xs text-muted">Total tracked</div>
                  </div>
                  <div className="ml-auto self-start">
                    <SourceBadge
                      source="snapshot"
                      asOf="2026-07-11"
                      note="Compliance counts from REX PM via the TLE Business Dashboard snapshot."
                    />
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-[13px] text-muted">
                  No compliance items tracked against your profile yet.
                </p>
              )}
            </div>

            <div className="card p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                My net income · Jan–Jun YTD
              </div>
              {stats.netIncomeYtd ? (
                <div className="mt-3 flex items-end gap-6">
                  <div>
                    <div className="stat-value">
                      {formatGBP(stats.netIncomeYtd.ytdTotal)}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      Net income year to date
                    </div>
                  </div>
                  <div className="ml-auto self-start">
                    <SourceBadge
                      source="snapshot"
                      asOf="2026-07-11"
                      note="Partner net income from the TLE Business Dashboard snapshot."
                    />
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-[13px] text-muted">
                  No net income row for your profile yet — it appears once
                  you&apos;re in the partner net income report.
                </p>
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
