"use client";

// Admin · Forecast tab — THE ROLL-UP. Live sum of every agent's self-set
// forecast for the month via /api/admin/forecasts, which returns
// { month, rows, rollup, actualMtd, predictedMonthEnd, varianceVsForecast }
// with one row per ACTIVE roster agent: { agentKey, displayName, userLinked,
// forecast: AgentForecast | null }. The roll-up, actual MTD, predicted
// month-end and variance are computed server-side and rendered as-is here;
// plus the Business Value cards, baseline costs and H2 reforecast P&L from
// the (admin-gated) seed.

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import StatCard from "@/components/StatCard";
import DataTable from "@/components/DataTable";
import type { SeedData } from "@/lib/seed-data"; // type-only — erased at build
import type { AgentForecast, StatValue } from "@/lib/types";
import {
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

/* ----------------------- /api/admin/forecasts payload ----------------------- */

interface AdminForecastRow {
  agentKey: string;
  displayName: string;
  userLinked: boolean;
  forecast: AgentForecast | null;
}

interface ForecastRollup {
  totalGciTarget: number;
  totalMoveInsTarget: number;
  totalMaTarget: number;
  agentsForecasted: number;
  agentsTotal: number;
}

interface ForecastsPayload {
  month: string;
  rows: AdminForecastRow[];
  rollup: ForecastRollup;
  actualMtd: StatValue;
  predictedMonthEnd: StatValue;
  varianceVsForecast: StatValue;
}

function isForecastsPayload(payload: unknown): payload is ForecastsPayload {
  if (!payload || typeof payload !== "object") return false;
  const obj = payload as Record<string, unknown>;
  return Array.isArray(obj.rows) && !!obj.rollup && typeof obj.rollup === "object";
}

/* --------------------------------- tab --------------------------------- */

export default function Forecast({ month, seed }: { month: string; seed: SeedData }) {
  const [data, setData] = useState<ForecastsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/forecasts?month=${encodeURIComponent(month)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Forecasts fetch failed (${res.status})`);
      const payload: unknown = await res.json();
      if (!isForecastsPayload(payload)) throw new Error("Unexpected payload");
      setData(payload);
    } catch {
      setError("Couldn't load agent forecasts.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const rollup: ForecastRollup = data?.rollup ?? {
    totalGciTarget: 0,
    totalMoveInsTarget: 0,
    totalMaTarget: 0,
    agentsForecasted: 0,
    agentsTotal: 0,
  };

  const forecastTableRows = rows.map((r) => ({
    agent: r.displayName,
    linked: r.userLinked ? "Linked" : "No portal account",
    isLinked: r.userLinked,
    gciTarget: r.forecast?.gciTarget ?? null,
    moveInsTarget: r.forecast?.moveInsTarget ?? null,
    maTarget: r.forecast?.maTarget ?? null,
    notes: r.forecast?.notes ?? "",
    updatedAt: r.forecast?.updatedAt ?? null,
  }));

  const bv = seed.businessValue;
  const h2 = seed.h2Reforecast;

  return (
    <div>
      {/* ------------------------- roll-up hero ------------------------- */}
      <SectionTitle source="Agent-set forecasts (live from the portal) · actuals via manual override → dashboard snapshot">
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
            value: rollup.totalGciTarget,
            display: formatGBP(rollup.totalGciTarget),
            source: "manual",
            note: "Live sum of agent-set GCI targets from the portal forecast store",
          }}
          sub={`${rollup.agentsForecasted} forecast${rollup.agentsForecasted === 1 ? "" : "s"} · ${formatNum(rollup.totalMoveInsTarget)} move-ins · ${formatNum(rollup.totalMaTarget)} MAs targeted`}
        />
        <StatCard
          big
          label="Actual MTD (combined GCI)"
          stat={data?.actualMtd ?? { value: null, source: "snapshot" }}
        />
        <StatCard
          big
          label="Predicted month-end"
          stat={data?.predictedMonthEnd ?? { value: null, source: "derived" }}
          sub="Actual MTD ÷ fraction of the month elapsed — straight run rate"
        />
        <StatCard
          big
          label="Variance vs forecast"
          stat={data?.varianceVsForecast ?? { value: null, source: "derived" }}
          sub={
            data?.varianceVsForecast?.value == null
              ? "Needs both a forecast total and an actual run rate"
              : data.varianceVsForecast.value < 0
                ? "Tracking behind partners' forecast at current run rate"
                : "Tracking ahead of partners' forecast at current run rate"
          }
        />
      </div>

      <p className="mt-3 text-xs text-muted">
        {loading
          ? "Loading forecasts…"
          : `${rollup.agentsForecasted} of ${rollup.agentsTotal} active agents have set a forecast for ${monthLabel(month)}.`}
      </p>

      <SectionTitle>Agent forecasts — {monthLabel(month)}</SectionTitle>
      <DataTable
        columns={[
          { key: "agent", label: "Agent" },
          {
            key: "linked",
            label: "Portal account",
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
            render: (row) =>
              row.updatedAt ? formatDate(row.updatedAt as string) : "—",
          },
        ]}
        rows={forecastTableRows as unknown as Record<string, unknown>[]}
        compact
      />
      {!loading && rollup.agentsForecasted === 0 && !error ? (
        <p className="mt-2 text-xs text-muted">
          No agent has set a forecast for {monthLabel(month)} yet — agents set
          theirs under Dashboard → Forecast.
        </p>
      ) : null}

      {/* ------------------------- business value ------------------------- */}
      <SectionTitle source={seed.sources.businessValue}>
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
      <SectionTitle source={seed.sources.h2Reforecast}>
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
