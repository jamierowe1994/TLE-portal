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
import SusanForecast from "@/components/SusanForecast";
import SourceNote from "@/components/SourceNote";
import { Bars } from "@/components/charts/Bars";
import DataTable from "@/components/DataTable";
import type { SeedData } from "@/lib/seed-data"; // type-only — erased at build
import type { AgentForecast, StatValue } from "@/lib/types";
import {
  formatDate,
  formatGBP,
  formatNum,
  formatPct,
  monthLabel,
  previousMonth,
} from "@/lib/format";

/** Just the slice of /api/admin/payprop-live the business-value block needs. */
interface ForecastSeries {
  months: string[];
  rows: Array<{
    month: string;
    susan: number | null;
    partners: number | null;
    actual: number | null;
    agentsForecasted: number;
  }>;
}

interface LivePayProp {
  income?: {
    byCategory?: Array<{ category: string; amount: number }>;
    /** Commission TLE kept — the TLE side of the split. Net of VAT. */
    agencyIncome?: number;
    /** Every fee charged, whoever received it. Net of VAT. */
    combinedGci?: number;
    /** Paid out to partners — the partner side of the split. Net of VAT. */
    paidToBeneficiaries?: number;
    /** Partners who actually earned a fee this month: the honest denominator
     *  for "per trading partner", rather than everyone on the roster. */
    agentsEarning?: number;
  } | null;
  portfolio?: { totalRentRoll?: number; totalProperties?: number } | null;
}

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

  /* ------------------------- business value, live -------------------------
     Rent roll and management fees were the June snapshot. Both are reachable,
     but they are DIFFERENT KINDS of figure and the section had been treating
     them as one:

       Management fees are a FLOW — they belong to a month, and July is the
       last month that finished, so July is what we ask for.

       Rent roll is a STOCK — what the book is worth right now. PayProp keeps
       no history of it, so "the rent roll at the end of July" does not exist
       anywhere and cannot be recovered. Today's is the honest answer, and it
       says so rather than being labelled July.

     Licence income and partner joining fees are in NEITHER: joining fees run
     through a separate bank account (Barclays/QuickBooks only) and licence
     income is in no connected system. MRI is therefore management fees only
     until the P&L upload lands, and is marked short rather than quietly
     understated. */
  /* The three forecasts side by side. Susan sets one for the business, the
     partners each set their own, and the month produces a third. They lived in
     three places and nobody could say whether the first two agreed — which was
     the entire question being asked. */
  const [series, setSeries] = useState<ForecastSeries | null>(null);
  const loadSeries = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/forecast-series?months=12", { cache: "no-store" });
      if (r.ok) setSeries((await r.json()) as ForecastSeries);
    } catch {
      /* leave it empty — an absent chart beats an invented one */
    }
  }, []);
  useEffect(() => {
    void loadSeries();
  }, [loadSeries]);

  const [live, setLive] = useState<LivePayProp | null>(null);
  const fees = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/admin/payprop-live?month=${encodeURIComponent(previousMonth())}`,
        { cache: "no-store" }
      );
      if (!r.ok) return;
      const d: unknown = await r.json();
      if (d && typeof d === "object") setLive(d as LivePayProp);
    } catch {
      /* leave the snapshot showing — a missing live read is not a zero */
    }
  }, []);
  useEffect(() => {
    void fees();
  }, [fees]);

  const susanThisMonth =
    series?.rows.find((r) => r.month === month)?.susan ?? null;

  const feeMonth = previousMonth();
  const cats = live?.income?.byCategory ?? [];
  const sumCats = (names: string[]) =>
    cats.filter((c) => names.includes(c.category)).reduce((t, c) => t + c.amount, 0);
  const liveMgmtFees = cats.length
    ? sumCats([
        "Management Fee",
        "Monthly Management Fee",
        "First Month Management Fee",
        "Management Fee - Investor Services",
      ])
    : null;
  const liveSetUp = cats.length ? sumCats(["Set Up Fee"]) : null;
  const rentRoll = live?.portfolio?.totalRentRoll ?? null;
  const managed = live?.portfolio?.totalProperties ?? null;
  const inc = live?.income ?? null;
  // Recurring is the management fee; everything else charged in the month is
  // one-off by definition — set-up, let-only, transfers. Derived by subtraction
  // rather than by naming categories, so a fee type PayProp adds tomorrow lands
  // in one-off instead of vanishing from the total.
  const liveOneOff =
    inc?.combinedGci != null && liveMgmtFees != null
      ? Math.max(0, inc.combinedGci - liveMgmtFees)
      : null;
  const liveTotalIncome = inc?.combinedGci ?? null;
  const perProperty =
    liveMgmtFees != null && managed ? liveMgmtFees / managed : null;
  const pctOfRentRoll =
    liveMgmtFees != null && rentRoll ? (liveMgmtFees / rentRoll) * 100 : null;
  const perPartner =
    liveMgmtFees != null && inc?.agentsEarning
      ? liveMgmtFees / inc.agentsEarning
      : null;
  const SHORT =
    " Short by licence income, which is in no connected system until the P&L is uploaded.";

  const liveStat = (
    value: number | null,
    display: string,
    note: string
  ): StatValue | null =>
    value == null ? null : { value, display, source: "live-payprop", note, asOf: feeMonth };

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
          label={`Susan's forecast for ${monthLabel(month)}`}
          stat={{
            value: susanThisMonth,
            display: susanThisMonth == null ? "—" : formatGBP(susanThisMonth),
            source: "manual",
            note: "Set by hand on this tab and stored with the other manual figures. Not derived from anything — it is the number Susan expects.",
          }}
          sub={
            susanThisMonth == null
              ? "Not set for this month"
              : rollup.totalGciTarget
                ? `${susanThisMonth >= rollup.totalGciTarget ? "Above" : "Below"} the partners' roll-up by ${formatGBP(Math.abs(susanThisMonth - rollup.totalGciTarget))}`
                : "No partner forecasts to compare with yet"
          }
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

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SusanForecast month={month} current={susanThisMonth} onSaved={loadSeries} />
      </div>

      {series && series.rows.some((r) => r.susan != null || r.partners != null) ? (
        <>
          <SectionTitle>
            Forecast vs forecast vs actual
          </SectionTitle>
          <div className="card p-5">
            <div className="mb-2 text-xs text-muted">
              Do the two forecasts agree, and does either one land?
              <SourceNote tone="derived">
                Susan&rsquo;s figure and the partners&rsquo; roll-up are both typed by
                people; the actual is live from PayProp, net of VAT. A month nobody
                forecast is left blank rather than drawn as zero — &ldquo;nobody has
                said yet&rdquo; and &ldquo;they forecast nothing&rdquo; are different
                claims.
              </SourceNote>
            </div>
            <Bars
              labels={series.rows.map((r) => monthLabel(r.month).slice(0, 3))}
              series={[
                { name: "Susan", color: "#101014", values: series.rows.map((r) => r.susan) },
                { name: "Partners", color: "#E31F36", values: series.rows.map((r) => r.partners) },
                { name: "Actual", color: "#5FA87C", values: series.rows.map((r) => r.actual) },
              ]}
              format={(n) => `£${Math.round(n / 1000)}k`}
              height={240}
              details={series.rows.map((r) => [
                ["Susan", r.susan == null ? "not set" : formatGBP(r.susan)],
                ["Partners", r.partners == null ? "none set" : formatGBP(r.partners)],
                ["Actual", r.actual == null ? "—" : formatGBP(r.actual)],
                ["Partners forecasting", String(r.agentsForecasted)],
              ])}
            />
          </div>
        </>
      ) : null}

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
        Business Value — Monthly Rent Roll &amp; Recurring Income (
        {monthLabel(feeMonth)})
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Monthly Rent Roll"
          stat={
            liveStat(
              rentRoll,
              rentRoll == null ? "—" : formatGBP(rentRoll),
              "Live from the PayProp portfolio walk, both agencies. This is a STOCK — what the book is worth today. PayProp keeps no history of it, so the rent roll as at the end of a past month cannot be recovered."
            ) ?? bv.monthlyRentRoll
          }
          sub={managed != null ? `${managed} managed properties · as at today` : "362 managed properties"}
        />
        <StatCard
          label="Monthly Management Fees"
          stat={
            liveStat(
              liveMgmtFees,
              liveMgmtFees == null ? "—" : formatGBP(liveMgmtFees),
              `Live from PayProp for ${monthLabel(feeMonth)}, net of VAT — Management Fee, Monthly Management Fee, First Month Management Fee and Investor Services summed across both agencies.`
            ) ?? bv.monthlyManagementFees
          }
          sub={monthLabel(feeMonth)}
        />
        <StatCard
          label="MRI — Monthly Recurring Income"
          stat={
            liveStat(
              liveMgmtFees,
              liveMgmtFees == null ? "—" : formatGBP(liveMgmtFees),
              "SHORT BY LICENCE INCOME. Management fees are live; licence income is in no connected system and needs the P&L upload, and partner joining fees run through a separate bank account entirely. This is the reachable part, not the whole of MRI."
            ) ?? bv.mri
          }
          sub="management fees only — licence income not yet reachable"
        />
        <StatCard
          label="One-off Fees"
          stat={
            liveStat(
              liveOneOff,
              liveOneOff == null ? "—" : formatGBP(liveOneOff),
              `Live for ${monthLabel(feeMonth)}: every fee charged, less the management fee — set-up, let-only and transfers. Partner JOINING fees are not in here and cannot be: they run through a separate bank account, reachable only via Barclays/QuickBooks.`
            ) ?? bv.oneOffFees
          }
          sub={monthLabel(feeMonth)}
        />
        <StatCard
          label="Total Monthly Income"
          stat={
            liveStat(
              liveTotalIncome,
              liveTotalIncome == null ? "—" : formatGBP(liveTotalIncome),
              `Live combined GCI for ${monthLabel(feeMonth)}, net of VAT, both agencies — recurring plus one-off.${SHORT} Joining fees are absent for the same reason as above.`
            ) ?? bv.totalMonthlyIncome
          }
          sub={monthLabel(feeMonth)}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="MRI per Property"
          stat={
            liveStat(
              perProperty,
              perProperty == null ? "—" : formatGBP(perProperty),
              `Management fees for ${monthLabel(feeMonth)} divided by the managed book as it stands today.${SHORT}`
            ) ?? bv.mriPerProperty
          }
          sub={managed != null ? `÷ ${managed} managed` : "avg rent £987"}
        />
        <StatCard
          label="MRI % per Property"
          stat={
            liveStat(
              pctOfRentRoll,
              pctOfRentRoll == null ? "—" : `${pctOfRentRoll.toFixed(1)}%`,
              `Management fees as a share of the rent roll. The fee is ${monthLabel(feeMonth)}; the rent roll is today's, because PayProp keeps no history of it.${SHORT}`
            ) ?? bv.mriPctPerProperty
          }
        />
        <StatCard
          label="MRI per Trading Partner"
          stat={
            liveStat(
              perPartner,
              perPartner == null ? "—" : formatGBP(perPartner),
              `Divided by partners who actually EARNED a fee this month, not everyone on the roster — a quiet month would otherwise flatter this figure.${SHORT}`
            ) ?? bv.mriPerTradingPartner
          }
          sub={inc?.agentsEarning ? `÷ ${inc.agentsEarning} earning` : "21 trading · 30 active"}
        />
        <StatCard
          label="MRI Split — TLE Retained"
          stat={
            liveStat(
              inc?.agencyIncome ?? null,
              inc?.agencyIncome == null ? "—" : formatGBP(inc.agencyIncome),
              `Commission the agency kept in ${monthLabel(feeMonth)}, net of VAT. This one is COMPLETE — it is measured from the payments themselves, not derived from MRI, so no licence gap applies.`
            ) ?? bv.mriSplitTle
          }
          sub={monthLabel(feeMonth)}
        />
        <StatCard
          label="MRI Split — Partner"
          stat={
            liveStat(
              inc?.paidToBeneficiaries ?? null,
              inc?.paidToBeneficiaries == null ? "—" : formatGBP(inc.paidToBeneficiaries),
              `Fees paid out to partners in ${monthLabel(feeMonth)}, net of VAT. Also complete, and measured the same way.`
            ) ?? bv.mriSplitPartner
          }
          sub={monthLabel(feeMonth)}
        />
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
