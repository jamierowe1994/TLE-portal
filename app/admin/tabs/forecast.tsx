"use client";

// Admin · Forecast tab — THE ROLL-UP. Live sum of every agent's self-set
// forecast for the month (forecast-store via /api/admin/forecasts), actual
// MTD, predicted month-end at current run rate and variance; plus the
// Business Value cards, baseline costs and H2 reforecast P&L from SEED.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import StatCard from "@/components/StatCard";
import DataTable from "@/components/DataTable";
import SourceBadge from "@/components/SourceBadge";
import { SEED, ROSTER } from "@/lib/seed-data";
import type { AgentForecast, StatValue, UserProfile } from "@/lib/types";
import {
  daysElapsedFraction,
  formatDate,
  formatGBP,
  formatNum,
  formatPct,
  monthLabel,
} from "@/lib/format";

/* ------------------------------ helpers ------------------------------ */

function money(value: number | null | undefined, pence = false): ReactNode {
  if (value == null || Number.isNaN(value)) return "—";
  if (value < 0) {
    return (
      <span className="text-red-600">({formatGBP(Math.abs(value), pence)})</span>
    );
  }
  return formatGBP(value, pence);
}

function SectionTitle({
  children,
  source,
}: {
  children: ReactNode;
  source?: string;
}) {
  return (
    <div className="mb-3 mt-8 first:mt-0">
      <h2 className="text-sm font-semibold uppercase tracking-wide">{children}</h2>
      {source ? (
        <p className="mt-0.5 text-[11px] text-muted">Source: {source}</p>
      ) : null}
    </div>
  );
}

/* -------------------- tolerant /api/admin/forecasts parsing -------------------- */

type ForecastRow = AgentForecast & { user?: Partial<UserProfile> };

function extractForecasts(payload: unknown): ForecastRow[] {
  if (Array.isArray(payload)) return payload as ForecastRow[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["forecasts", "rows", "items"]) {
      if (Array.isArray(obj[key])) return obj[key] as ForecastRow[];
    }
  }
  return [];
}

function extractUsers(payload: unknown): UserProfile[] {
  if (Array.isArray(payload)) return payload as UserProfile[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.users)) return obj.users as UserProfile[];
  }
  return [];
}

/** Actual MTD combined GCI for the month, from the snapshot. */
function actualGciStat(month: string): StatValue {
  if (month === "2026-07") return SEED.income.julyMtd.combinedGci;
  const key = (
    { "2026-01": "jan", "2026-02": "feb", "2026-03": "mar", "2026-04": "apr", "2026-05": "may", "2026-06": "jun" } as Record<string, "jan" | "feb" | "mar" | "apr" | "may" | "jun">
  )[month];
  const row = SEED.income.monthlyTable.find(
    (r) => r.metric === "Combined GCI (exc VAT)"
  );
  const value = key && row ? row[key] : null;
  return {
    value,
    display: value != null ? formatGBP(value) : "—",
    source: "snapshot",
    note: "Combined GCI (exc VAT) — TLE Business Income table, dashboard snapshot 11 Jul 2026",
    asOf: "2026-07-11",
  };
}

/* --------------------------------- tab --------------------------------- */

export default function Forecast({ month }: { month: string }) {
  const [forecasts, setForecasts] = useState<ForecastRow[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fRes, uRes] = await Promise.all([
        fetch(`/api/admin/forecasts?month=${encodeURIComponent(month)}`, { cache: "no-store" }),
        fetch("/api/admin/users", { cache: "no-store" }),
      ]);
      if (fRes.ok) setForecasts(extractForecasts(await fRes.json()));
      else setError("Couldn't load agent forecasts.");
      if (uRes.ok) setUsers(extractUsers(await uRes.json()));
    } catch {
      setError("Couldn't load agent forecasts.");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const usersById = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const u of users) map.set(u.id, u);
    return map;
  }, [users]);

  const rosterByKey = useMemo(() => {
    const map = new Map<string, (typeof ROSTER)[number]>();
    for (const r of ROSTER) map.set(r.agentKey, r);
    return map;
  }, []);

  // Roll-up: live sum of self-set forecasts.
  const totalGciTarget = forecasts.reduce((s, f) => s + (f.gciTarget ?? 0), 0);
  const totalMiTarget = forecasts.reduce((s, f) => s + (f.moveInsTarget ?? 0), 0);
  const totalMaTarget = forecasts.reduce((s, f) => s + (f.maTarget ?? 0), 0);

  const actual = actualGciStat(month);
  const fraction = daysElapsedFraction(month);
  const predicted =
    actual.value != null && fraction > 0 ? actual.value / fraction : null;
  const variance =
    predicted != null && totalGciTarget > 0 ? predicted - totalGciTarget : null;

  const activeAgents = ROSTER.filter(
    (r) => r.active && r.agentKey !== "tle-central"
  ).length;

  const forecastTableRows = forecasts.map((f) => {
    const user = f.user?.id ? { ...f.user, ...usersById.get(f.user.id) } : usersById.get(f.userId);
    const agentKey = (user?.agentKey ?? f.user?.agentKey) || null;
    const roster = agentKey ? rosterByKey.get(agentKey) : undefined;
    return {
      agent: roster?.displayName ?? user?.name ?? f.user?.name ?? f.userId,
      linked: roster ? `Linked · ${roster.agentKey}` : "Not linked",
      isLinked: !!roster,
      gciTarget: f.gciTarget,
      moveInsTarget: f.moveInsTarget,
      maTarget: f.maTarget,
      notes: f.notes ?? "",
      updatedAt: f.updatedAt,
    };
  });

  const bv = SEED.businessValue;
  const h2 = SEED.h2Reforecast;

  return (
    <div>
      {/* ------------------------- roll-up hero ------------------------- */}
      <SectionTitle source="Agent-set forecasts (live from the portal) · actuals from dashboard snapshot">
        Partner Forecast Roll-up — {monthLabel(month)}
      </SectionTitle>

      {error ? (
        <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          big
          label={`Partners forecast for ${monthLabel(month)}`}
          stat={{
            value: totalGciTarget,
            display: formatGBP(totalGciTarget),
            source: "manual",
            note: "Live sum of agent-set GCI targets from the portal forecast store",
          }}
          sub={`${forecasts.length} forecast${forecasts.length === 1 ? "" : "s"} · ${formatNum(totalMiTarget)} move-ins · ${formatNum(totalMaTarget)} MAs targeted`}
        />
        <StatCard
          big
          label="Actual MTD (combined GCI)"
          stat={actual}
        />
        <StatCard
          big
          label="Predicted month-end"
          stat={{
            value: predicted,
            display: predicted != null ? formatGBP(predicted) : "—",
            source: "derived",
            note:
              fraction > 0
                ? `Actual MTD ÷ ${formatPct(fraction * 100)} of the month elapsed — straight run rate`
                : "Month not started — no run rate yet",
          }}
          sub={fraction > 0 && fraction < 1 ? `${formatPct(fraction * 100)} of the month elapsed` : undefined}
        />
        <div className="card relative p-5">
          <div className="absolute right-4 top-4">
            <SourceBadge
              source="derived"
              note="Predicted month-end vs partners' summed forecast"
            />
          </div>
          <div className="stat-label pr-16 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Variance vs forecast
          </div>
          <div className="stat-value mt-2">
            {variance == null ? (
              "—"
            ) : (
              <span className={variance < 0 ? "text-red-600" : "text-green-700"}>
                {variance < 0 ? "−" : "+"}
                {formatGBP(Math.abs(variance))}
              </span>
            )}
          </div>
          <div className="mt-1.5 text-xs text-muted">
            {variance == null
              ? "Needs both a forecast total and an actual run rate"
              : variance < 0
                ? "Tracking behind partners' forecast at current run rate"
                : "Tracking ahead of partners' forecast at current run rate"}
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted">
        {loading
          ? "Loading forecasts…"
          : `${forecasts.length} of ${activeAgents} active agents have set a forecast for ${monthLabel(month)}.`}
      </p>

      <SectionTitle>Agent forecasts — {monthLabel(month)}</SectionTitle>
      <DataTable
        columns={[
          { key: "agent", label: "Agent" },
          {
            key: "linked",
            label: "Linked?",
            render: (row) => (
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  row.isLinked
                    ? "border-green-200 bg-green-50 text-green-700"
                    : "border-gray-200 bg-gray-100 text-gray-500"
                }`}
              >
                {String(row.linked)}
              </span>
            ),
          },
          {
            key: "gciTarget",
            label: "GCI target",
            align: "right",
            render: (row) => money(row.gciTarget as number | null),
          },
          {
            key: "moveInsTarget",
            label: "Move-ins target",
            align: "right",
            render: (row) => formatNum(row.moveInsTarget as number | null),
          },
          {
            key: "maTarget",
            label: "MA target",
            align: "right",
            render: (row) => formatNum(row.maTarget as number | null),
          },
          { key: "notes", label: "Notes" },
          {
            key: "updatedAt",
            label: "Updated",
            align: "right",
            render: (row) => formatDate(row.updatedAt as string),
          },
        ]}
        rows={forecastTableRows as unknown as Record<string, unknown>[]}
        compact
      />
      {!loading && forecasts.length === 0 && !error ? (
        <p className="mt-2 text-xs text-muted">
          No agent has set a forecast for {monthLabel(month)} yet — agents set
          theirs under Dashboard → Forecast.
        </p>
      ) : null}

      {/* ------------------------- business value ------------------------- */}
      <SectionTitle source={SEED.sources.businessValue}>
        Business Value — Monthly Rent Roll & Recurring Income (June 2026)
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Monthly Rent Roll" stat={bv.monthlyRentRoll} sub="362 managed properties" />
        <StatCard label="Monthly Management Fees" stat={bv.monthlyManagementFees} />
        <StatCard label="MRI — Monthly Recurring Income" stat={bv.mri} />
        <StatCard label="One-off Fees" stat={bv.oneOffFees} />
        <StatCard label="Total Monthly Income" stat={bv.totalMonthlyIncome} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="MRI per Property" stat={bv.mriPerProperty} sub="avg rent £987" />
        <StatCard label="MRI % per Property" stat={bv.mriPctPerProperty} />
        <StatCard label="MRI per Trading Partner" stat={bv.mriPerTradingPartner} sub="21 trading · 30 active" />
        <StatCard label="MRI Split — TLE Retained" stat={bv.mriSplitTle} />
        <StatCard label="MRI Split — Partner" stat={bv.mriSplitPartner} />
      </div>
      <p className="mt-3 text-xs text-muted">{bv.glasgowNote}</p>

      {/* --------------------- baseline costs vs income --------------------- */}
      <SectionTitle source="May 2026 cost actuals">
        Baseline Costs vs Income
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Monthly Gap" stat={bv.monthlyGap} sub="Recurring GP + one-off − baseline" />
        <StatCard label="Cost Coverage" stat={bv.costCoveragePct} sub="of baseline covered by total income" />
        <StatCard label="Direct / Variable Costs" stat={bv.baselineCosts.directSubtotal} />
        <StatCard label="Fixed Operational Costs" stat={bv.baselineCosts.fixedSubtotal} />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Cost lines (monthly)
          </h3>
          <DataTable
            columns={[
              { key: "label", label: "Cost line" },
              {
                key: "value",
                label: "£ / month",
                align: "right",
                render: (row) => money(row.value as number),
              },
            ]}
            rows={
              [
                ...bv.baselineCosts.direct.map((r) => ({ ...r, label: `${r.label} (direct)` })),
                ...bv.baselineCosts.fixed,
                { label: "TOTAL BASELINE COSTS", value: bv.baselineCosts.total.value ?? 0 },
              ] as unknown as Record<string, unknown>[]
            }
            compact
          />
        </div>
        <div className="card h-fit p-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            One-off / non-recurring income (monthly)
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Set-up & Other (TLE share)" stat={bv.oneOffIncome.setupAndOtherTleShare} />
            <StatCard label="Partner Joining Fees" stat={bv.oneOffIncome.partnerJoiningFees} />
            <StatCard label="Total One-off" stat={bv.oneOffIncome.total} />
          </div>
          <p className="mt-3 text-xs text-muted">{bv.forecast750Note}</p>
        </div>
      </div>

      {/* ------------------------ H2 reforecast P&L ------------------------ */}
      <SectionTitle source={SEED.sources.h2Reforecast}>
        H2 2026 Reforecast — Month-by-Month P&L
      </SectionTitle>
      <div className="mb-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="H2 Net Loss" stat={h2.h2NetLoss} />
        <StatCard label="Cumulative YTD (Dec)" stat={h2.cumulativeYtdDec} />
        <div className="card col-span-2 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Break-even
          </div>
          <p className="mt-2 text-sm">{h2.breakEvenNote}</p>
          <p className="mt-1.5 text-xs text-muted">{h2.assumptions}</p>
        </div>
      </div>
      <DataTable
        columns={[
          { key: "label", label: "H2 2026" },
          ...h2.months.map((m, i) => ({
            key: `m${i}`,
            label: m,
            align: "right" as const,
            render: (row: Record<string, unknown>) =>
              formatH2Cell(
                (row.values as number[])[i],
                row.kind as string,
                row.key as string
              ),
          })),
          {
            key: "h2Total",
            label: "H2 Total",
            align: "right",
            render: (row) =>
              formatH2Cell(row.h2Total as number, row.kind as string, row.key as string),
          },
        ]}
        rows={h2.rows as unknown as Record<string, unknown>[]}
        compact
      />
      <p className="mt-2 text-[11px] text-muted">{h2.sourceNote}</p>
    </div>
  );
}

/** Format one H2 reforecast cell per row kind (negatives in red parentheses). */
function formatH2Cell(value: number, kind: string, rowKey: string): ReactNode {
  if (kind === "pct") return formatPct(value, 1);
  if (kind === "count") {
    if (rowKey === "starters" && value >= 0) return `+${formatNum(value)}`;
    if (value < 0) return <span className="text-red-600">−{formatNum(Math.abs(value))}</span>;
    return formatNum(value);
  }
  // currency
  if (value < 0) {
    return <span className="text-red-600">({formatGBP(Math.abs(value))})</span>;
  }
  return formatGBP(value);
}
