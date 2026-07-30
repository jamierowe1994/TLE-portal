"use client";

// Admin tab: Compliance — totals, by-type table, by-agent table with an
// overdue % bar. Sourced from the REX PM compliance report (a candidate for a
// live pull later) via the 11 Jul 2026 snapshot.

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import type { SeedData } from "@/lib/seed-data"; // type-only — erased at build
import type { ComplianceAgentRow, ComplianceTypeRow } from "@/lib/seed-types";
import { formatPct, monthLabel } from "@/lib/format";

interface LiveCompliance {
  totalItems: number;
  overdue: number;
  upcoming: number;
  valid: number;
  byType: Array<{ type: string; total: number; overdue: number; upcoming: number }>;
}

const pct = (n: number, total: number) =>
  total ? `${((n / total) * 100).toFixed(1)}%` : "—";

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

export default function ComplianceTab({ month, seed }: { month: string; seed: SeedData }) {
  const c = seed.compliance;
  const isSnapshotMonth = month === "2026-07";

  // Live totals from REX. The sweep takes a while on a large account, so poll
  // rather than blocking the tab on it.
  const [live, setLive] = useState<LiveCompliance | null>(null);
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const ask = () => {
      fetch("/api/admin/compliance-live", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { compliance?: LiveCompliance | null }) => {
          if (cancelled) return;
          if (d.compliance) setLive(d.compliance);
          else if (tries++ < 40) setTimeout(ask, 5000);
        })
        .catch(() => {});
    };
    ask();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Source banner */}
      {live ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
          <span className="font-semibold">Live from REX</span> —{" "}
          {live.totalItems.toLocaleString("en-GB")} compliance entries across the
          account, <span className="font-semibold">{live.overdue}</span> overdue
          and {live.upcoming} due within 60 days.
        </div>
      ) : null}
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
        <StatCard
          label="Compliance items"
          stat={
            live
              ? { value: live.totalItems, source: "live-rex", note: "Every active compliance entry in REX, across the whole account." }
              : c.totals.totalItems
          }
          big
        />
        <StatCard
          label="Overdue"
          stat={
            live
              ? { value: live.overdue, source: "live-rex", note: "Certificates past their expiry date." }
              : c.totals.overdue
          }
          big
          sub={live ? `${pct(live.overdue, live.totalItems)} of total` : "50.7% of total"}
        />
        <StatCard
          label="Upcoming"
          stat={
            live
              ? { value: live.upcoming, source: "live-rex", note: "Expiring within the next 60 days." }
              : c.totals.upcoming
          }
          big
          sub={live ? `${pct(live.upcoming, live.totalItems)} of total · next 60 days` : "49.3% of total"}
        />
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
