"use client";

// Admin tab: Portfolio — overview cards + portfolio-by-partner table.
// PayProp is the source system; no API access yet, so everything is the
// 11 Jul 2026 snapshot. (No portfolio growth time series exists in the
// snapshot, so no growth chart is rendered.)

import StatCard from "@/components/StatCard";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import { SEED } from "@/lib/seed-data";
import type { PortfolioRow } from "@/lib/seed-types";
import { formatGBP, monthLabel } from "@/lib/format";

const COLUMNS: DataTableColumn<PortfolioRow & Record<string, unknown>>[] = [
  {
    key: "agent",
    label: "Partner",
    render: (r) => (
      <span className={r.agent === "TOTAL" ? "font-semibold" : undefined}>{r.agent}</span>
    ),
  },
  { key: "managed", label: "Managed", align: "right" },
  { key: "letOnly", label: "Let only", align: "right" },
  {
    key: "total",
    label: "Total",
    align: "right",
    render: (r) => <span className="font-semibold">{r.total.toLocaleString("en-GB")}</span>,
  },
  { key: "rlpLec", label: "RLP / LEC", align: "right" },
  {
    key: "rentRoll",
    label: "Rent roll",
    align: "right",
    render: (r) => (r.rentRoll == null ? "—" : formatGBP(r.rentRoll)),
  },
  {
    key: "avgRent",
    label: "Avg rent",
    align: "right",
    render: (r) => (r.avgRent == null ? "—" : formatGBP(r.avgRent)),
  },
];

export default function PortfolioTab({ month }: { month: string }) {
  const p = SEED.portfolio;
  const o = p.overview;
  const isSnapshotMonth = month === "2026-07";
  const rows = [...p.byPartner, p.totals];

  return (
    <div className="space-y-6">
      {/* Source banner */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
        <span className="font-semibold">PayProp — awaiting API access.</span>{" "}
        Portfolio figures are from the E&amp;W &amp; Glasgow PayProp portfolio
        report (June 2026), captured in the 11 Jul 2026 dashboard snapshot.
      </div>

      {!isSnapshotMonth ? (
        <div className="rounded-2xl border border-line bg-card px-4 py-3 text-[13px] text-muted">
          Snapshot data covers July 2026 — figures below are from the 11 Jul
          2026 capture, not {monthLabel(month)}.
        </div>
      ) : null}

      {/* Overview */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Portfolio overview</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total properties" stat={o.total} big sub="E&W 442 · Glasgow 83" />
          <StatCard label="Managed" stat={o.totalManaged} big sub="E&W 279 · Glasgow 83" />
          <StatCard
            label="Let only"
            stat={o.eAndWLetOnly}
            sub="All E&W — Glasgow has 0 let-only"
          />
          <StatCard label="Monthly rent roll" stat={o.rentRollTotal} big sub="E&W £318,806 · Glasgow £38,625" />
        </div>
      </section>

      {/* Rent protection */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Managed — rent protection</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="No protection" stat={o.noProtection} />
          <StatCard label="With RLP" stat={o.withRlp} />
          <StatCard label="With LEC" stat={o.withLec} />
          <StatCard label="Protected %" stat={o.protectedPct} sub="of managed portfolio" />
        </div>
      </section>

      {/* Rents + health */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Rents &amp; portfolio health</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Avg rent — E&W" stat={o.avgRentEAndW} />
          <StatCard label="Avg rent — Glasgow" stat={o.avgRentGlasgow} />
          <StatCard label="Vacant" stat={o.vacant} />
          <StatCard label="Renewals due" stat={o.renewals} />
          <StatCard label="In arrears" stat={o.arrears} sub="See Arrears tab (admin only)" />
        </div>
      </section>

      {/* By partner */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          Portfolio by partner — June 2026 ({p.byPartner.length} partners)
        </h2>
        <DataTable columns={COLUMNS} rows={rows} compact />
        <p className="text-xs text-muted">{p.source}</p>
      </section>
    </div>
  );
}
