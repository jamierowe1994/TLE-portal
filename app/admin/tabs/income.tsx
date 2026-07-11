"use client";

// Admin tab: Income — July MTD estimates, June finals, Jan–Jun monthly income
// table, licence fee table, YoY growth chips, GCI vs total income bars.
// GCI actuals come from PayProp reports (no API access yet) — snapshot badges.

import StatCard from "@/components/StatCard";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import Donut from "@/components/charts/Donut";
import Bars from "@/components/charts/Bars";
import type { SeedData } from "@/lib/seed-data"; // type-only — erased at build
import type { IncomeMonthlyRow, LicenceFeeRow } from "@/lib/seed-types";
import { formatGBP, formatNum, monthLabel } from "@/lib/format";

/* ------------------------------ table columns ------------------------------ */

function money(v: number | null): string {
  return v == null ? "—" : formatGBP(v);
}

const HIGHLIGHT_METRICS = new Set(["Combined GCI (exc VAT)", "TOTAL INCOME"]);

const MONTHLY_COLUMNS: DataTableColumn<IncomeMonthlyRow & Record<string, unknown>>[] = [
  {
    key: "metric",
    label: "Metric",
    render: (r) => (
      <span className={HIGHLIGHT_METRICS.has(r.metric) ? "font-semibold" : undefined}>
        {r.metric}
      </span>
    ),
  },
  { key: "jan", label: "Jan", align: "right", render: (r) => money(r.jan) },
  { key: "feb", label: "Feb", align: "right", render: (r) => money(r.feb) },
  { key: "mar", label: "Mar", align: "right", render: (r) => money(r.mar) },
  {
    key: "q1",
    label: "Q1",
    align: "right",
    render: (r) => <span className="font-semibold">{money(r.q1)}</span>,
  },
  { key: "apr", label: "Apr", align: "right", render: (r) => money(r.apr) },
  { key: "may", label: "May", align: "right", render: (r) => money(r.may) },
  { key: "jun", label: "Jun", align: "right", render: (r) => money(r.jun) },
  {
    key: "q2",
    label: "Q2",
    align: "right",
    render: (r) => <span className="font-semibold">{money(r.q2)}</span>,
  },
  {
    key: "ytd",
    label: "YTD",
    align: "right",
    render: (r) => <span className="font-semibold">{money(r.ytd)}</span>,
  },
];

const LICENCE_COLUMNS: DataTableColumn<LicenceFeeRow & Record<string, unknown>>[] = [
  {
    key: "month",
    label: "Month",
    render: (r) => (
      <span className={r.month === "YTD Total" ? "font-semibold" : undefined}>{r.month}</span>
    ),
  },
  { key: "monthlyLicence", label: "Monthly licence", align: "right", render: (r) => money(r.monthlyLicence) },
  { key: "proLicence", label: "Pro licence", align: "right", render: (r) => money(r.proLicence) },
  { key: "joiningFees", label: "Joining fees", align: "right", render: (r) => money(r.joiningFees) },
  {
    key: "total",
    label: "Total",
    align: "right",
    render: (r) => <span className="font-semibold">{money(r.total)}</span>,
  },
];

/* ------------------------------- YoY chip row ------------------------------- */

function YoyChips({ label, data }: { label: string; data: Record<string, number> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      {Object.entries(data).map(([m, v]) => (
        <span
          key={m}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tnum ${
            v >= 0
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {m} {v >= 0 ? "+" : ""}
          {formatNum(v)}%
        </span>
      ))}
    </div>
  );
}

/* --------------------------------- the tab --------------------------------- */

export default function IncomeTab({ month, seed }: { month: string; seed: SeedData }) {
  const inc = seed.income;
  const isSnapshotMonth = month === "2026-07";

  // GCI vs total income bars, Jan–Jun (from the monthly income table rows)
  const gciRow = inc.monthlyTable.find((r) => r.metric === "Combined GCI (exc VAT)");
  const totalRow = inc.monthlyTable.find((r) => r.metric === "TOTAL INCOME");
  const monthKeys = ["jan", "feb", "mar", "apr", "may", "jun"] as const;
  const barLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const barSeries = [
    {
      name: "Combined GCI (exc VAT)",
      color: "#E31F36",
      values: monthKeys.map((k) => gciRow?.[k] ?? null),
    },
    {
      name: "Total income",
      color: "#101014",
      values: monthKeys.map((k) => totalRow?.[k] ?? null),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Source banner */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
        <span className="font-semibold">PayProp pending</span> — GCI actuals
        come from E&amp;W &amp; Glasgow PayProp reports; API access not yet
        granted, so figures are from the 11 Jul 2026 dashboard snapshot.
      </div>

      {!isSnapshotMonth ? (
        <div className="rounded-2xl border border-line bg-card px-4 py-3 text-[13px] text-muted">
          Snapshot data covers July 2026 — figures below are from the 11 Jul
          2026 capture, not {monthLabel(month)}.
        </div>
      ) : null}

      {/* July MTD estimates */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">July MTD — estimates</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Combined GCI (est)" stat={inc.julyMtd.combinedGci} big />
          <StatCard label="E&W GCI (est)" stat={inc.julyMtd.eAndWGci} />
          <StatCard label="Glasgow GCI (est)" stat={inc.julyMtd.glasgowGci} />
          <StatCard label="TLE net income (est)" stat={inc.julyMtd.tleNetIncome} />
          <StatCard label="Paid to associates (est)" stat={inc.julyMtd.paidToAssociates} />
          <StatCard label="June final GCI" stat={inc.julyMtd.juneFinalGci} sub="Previous month, final" />
        </div>
      </section>

      {/* Split donut + June finals */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-5">
          <h2 className="text-sm font-semibold">TLE / partner split — July MTD est</h2>
          <div className="mt-4">
            <Donut
              segments={[
                { label: "TLE net", value: inc.julyMtd.tleNetIncome.value ?? 0, color: "#E31F36" },
                { label: "Associates", value: inc.julyMtd.paidToAssociates.value ?? 0, color: "#101014" },
              ]}
              centerLabel={inc.julyMtd.combinedGci.display ?? ""}
            />
          </div>
          <p className="mt-3 text-xs text-muted">{inc.julyMtd.splitNote}</p>
        </section>

        <section className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">June 2026 — final</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Total GCI" stat={inc.june.totalGci} />
            <StatCard label="Total income" stat={inc.june.totalIncome} />
            <StatCard label="TLE net income" stat={inc.june.tleNetIncome} />
            <StatCard label="GCI per agent" stat={inc.june.gciPerAgent} />
            <StatCard label="Net income per agent" stat={inc.june.netIncomePerAgent} />
            <StatCard
              label="TLE split of E&W GCI"
              stat={inc.june.tleSplitPct}
              sub={`Partners ${100 - (inc.june.tleSplitPct.value ?? 0)}% — ${inc.june.partnerNetIncome.display ?? ""}`}
            />
            <StatCard label="Monthly licence" stat={inc.june.monthlyLicence} />
            <StatCard label="Pro licence" stat={inc.june.proLicence} />
            <StatCard label="Joining fees" stat={inc.june.joiningFees} />
          </div>
        </section>
      </div>

      {/* Monthly income table */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          TLE business income — Jan–Jun 2026 (all fees exc VAT)
        </h2>
        <DataTable columns={MONTHLY_COLUMNS} rows={inc.monthlyTable} compact />
        <p className="text-xs text-muted">{inc.modelNote}</p>
      </section>

      {/* GCI vs total income bars */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold">Combined GCI vs total income — Jan–Jun 2026</h2>
        <div className="mt-4">
          <Bars labels={barLabels} series={barSeries} format={(n) => `£${formatNum(n / 1000)}k`} />
        </div>
      </section>

      {/* Licence fee table */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Licence fee income — 2026</h2>
        <DataTable columns={LICENCE_COLUMNS} rows={inc.licenceFeeTable} compact />
      </section>

      {/* YoY growth */}
      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold">Year-on-year GCI growth (gross, exc VAT)</h2>
        <YoyChips label="2024 → 2025" data={inc.yoyGrowthPct["2024to2025"]} />
        <YoyChips label="2025 → 2026" data={inc.yoyGrowthPct["2025to2026"]} />
      </section>
    </div>
  );
}
