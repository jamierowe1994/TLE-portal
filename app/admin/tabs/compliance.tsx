"use client";

// Admin tab: Compliance — totals, by-type table, by-agent table with an
// overdue % bar. Sourced from the REX PM compliance report (a candidate for a
// live pull later) via the 11 Jul 2026 snapshot.

import StatCard from "@/components/StatCard";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import { SEED } from "@/lib/seed-data";
import type { ComplianceAgentRow, ComplianceTypeRow } from "@/lib/seed-types";
import { formatPct, monthLabel } from "@/lib/format";

function PctOverdueBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${clamped >= 75 ? "bg-accent" : clamped >= 40 ? "bg-amber-400" : "bg-green-500"}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="w-10 text-right tnum">{formatPct(pct)}</span>
    </div>
  );
}

const TYPE_COLUMNS: DataTableColumn<ComplianceTypeRow & Record<string, unknown>>[] = [
  {
    key: "type",
    label: "Certificate type",
    render: (r) => (
      <span className={r.type === "Total" ? "font-semibold" : undefined}>{r.type}</span>
    ),
  },
  { key: "total", label: "Total", align: "right" },
  {
    key: "overdue",
    label: "Overdue",
    align: "right",
    render: (r) => <span className={r.overdue > 0 ? "font-semibold text-accent" : undefined}>{r.overdue}</span>,
  },
  { key: "upcoming", label: "Upcoming", align: "right" },
];

const AGENT_COLUMNS: DataTableColumn<ComplianceAgentRow & Record<string, unknown>>[] = [
  {
    key: "agent",
    label: "Partner",
    render: (r) => (
      <span className={r.agent === "Total" ? "font-semibold" : undefined}>{r.agent}</span>
    ),
  },
  { key: "total", label: "Total", align: "right" },
  {
    key: "overdue",
    label: "Overdue",
    align: "right",
    render: (r) => <span className={r.overdue > 0 ? "font-semibold text-accent" : undefined}>{r.overdue}</span>,
  },
  { key: "upcoming", label: "Upcoming", align: "right" },
  {
    key: "pctOverdue",
    label: "% overdue",
    align: "right",
    render: (r) => <PctOverdueBar pct={r.pctOverdue} />,
  },
];

export default function ComplianceTab({ month }: { month: string }) {
  const c = SEED.compliance;
  const isSnapshotMonth = month === "2026-07";

  return (
    <div className="space-y-6">
      {/* Source banner */}
      <div className="rounded-2xl border border-line bg-accent-soft px-4 py-3 text-[13px] text-ink">
        <span className="font-semibold">Source: REX PM compliance report</span>{" "}
        (report date {c.reportDate}) — a candidate for a live pull via the REX
        Property Management module; snapshot figures until then.
      </div>

      {!isSnapshotMonth ? (
        <div className="rounded-2xl border border-line bg-card px-4 py-3 text-[13px] text-muted">
          Snapshot data covers July 2026 — figures below are from the 11 Jul
          2026 capture, not {monthLabel(month)}.
        </div>
      ) : null}

      {/* Totals */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Compliance items" stat={c.totals.totalItems} big />
        <StatCard label="Overdue" stat={c.totals.overdue} big sub="50.7% of total" />
        <StatCard label="Upcoming" stat={c.totals.upcoming} big sub="49.3% of total" />
      </div>

      {/* By type */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">By certificate type</h2>
        <DataTable
          columns={TYPE_COLUMNS}
          rows={[...c.byType, c.byTypeTotal]}
          compact
        />
      </section>

      {/* By agent */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">By partner</h2>
        <DataTable
          columns={AGENT_COLUMNS}
          rows={[...c.byAgent, c.byAgentTotal]}
          compact
        />
        <p className="text-xs text-muted">{c.source}</p>
      </section>
    </div>
  );
}
