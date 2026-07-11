"use client";

// Admin tab: Arrears — summary, aging buckets, full tenant table.
// ADMIN ONLY: contains tenant personal data. PayProp-sourced (no API access
// yet) — figures from the PayProp arrears report 2026-07-06 via the snapshot.

import StatCard from "@/components/StatCard";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import { SEED } from "@/lib/seed-data";
import type { ArrearsTenantRow } from "@/lib/seed-types";
import { formatDate, formatGBP, formatNum, monthLabel } from "@/lib/format";

const COLUMNS: DataTableColumn<ArrearsTenantRow & Record<string, unknown>>[] = [
  { key: "tenant", label: "Tenant" },
  { key: "property", label: "Property" },
  { key: "region", label: "Region" },
  {
    key: "balance",
    label: "Balance",
    align: "right",
    render: (r) => <span className="font-semibold text-accent">{formatGBP(r.balance, true)}</span>,
  },
  { key: "status", label: "Status" },
  { key: "protection", label: "Protection" },
  { key: "lastInvoice", label: "Last invoice", align: "right", render: (r) => formatDate(r.lastInvoice) },
  { key: "lastPayment", label: "Last payment", align: "right", render: (r) => formatDate(r.lastPayment) },
  { key: "lastReminder", label: "Last reminder", align: "right", render: (r) => formatDate(r.lastReminder) },
];

export default function ArrearsTab({ month }: { month: string }) {
  const a = SEED.arrears;
  const s = a.summary;
  const isSnapshotMonth = month === "2026-07";

  return (
    <div className="space-y-6">
      {/* Source + privacy banner */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
        <span className="font-semibold">PayProp — awaiting API access.</span>{" "}
        Figures from the PayProp &ldquo;Tenants in Arrears&rdquo; report,
        2026-07-06, via the dashboard snapshot.{" "}
        <span className="font-semibold">
          This view is admin-only — it contains tenant personal data.
        </span>
      </div>

      {!isSnapshotMonth ? (
        <div className="rounded-2xl border border-line bg-card px-4 py-3 text-[13px] text-muted">
          Snapshot data covers July 2026 — figures below are from the 11 Jul
          2026 capture, not {monthLabel(month)}.
        </div>
      ) : null}

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Tenants in arrears" stat={s.totalInArrears} big />
        <StatCard label="Total arrears" stat={s.totalValue} big />
        <StatCard label="E&W" stat={s.eAndWCount} sub="£10,611.07" />
        <StatCard label="Glasgow" stat={s.glasgowCount} sub="£9,270.97" />
        <StatCard label="Protected (RLP/LEC)" stat={s.protectedCount} sub="£0.00 claimable — 21 unprotected" />
        <StatCard label="% of rent roll" stat={s.pctOfRentRoll} sub="£19,882.04 of £357,431" />
      </div>

      {/* Aging buckets */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Arrears aging</h2>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {a.aging.map((b) => (
            <div key={b.label} className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {b.label}
              </div>
              <div className="stat-value mt-1.5 text-[24px]">{formatNum(b.count)}</div>
              <div className="mt-0.5 text-xs text-muted tnum">
                {formatGBP(b.value, true)}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">{a.agingNote}</p>
      </section>

      {/* Tenant table */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          Tenants in arrears — {a.tenants.length} records
        </h2>
        <DataTable columns={COLUMNS} rows={a.tenants} compact />
        <p className="text-xs text-muted">{a.footer}</p>
      </section>
    </div>
  );
}
