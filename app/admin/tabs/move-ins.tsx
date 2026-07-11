"use client";

// Admin tab: Move-ins & pipeline — header stats, July move-ins table (10 rows),
// July pipeline (26 rows), forward pipeline Aug–Sep (25 rows).
// Admin can record a manual override of the July move-in count — an honest
// count adjustment written to /api/admin/actuals (metric "funnel.moveIns"),
// shown with a MANUAL badge, not a fake table row.

import { useCallback, useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import SourceBadge from "@/components/SourceBadge";
import { SEED } from "@/lib/seed-data";
import type { PipelineRow, MoveInRow } from "@/lib/seed-types";
import { resolveStat, type ManualOverride } from "@/lib/stats";
import { formatGBP, monthLabel } from "@/lib/format";
import type { ActualOverride, StatValue } from "@/lib/types";

/* ------------------------------ status chips ------------------------------ */

const STATUS_CHIP: Record<string, string> = {
  "PLC Sign Off": "bg-blue-50 text-blue-700 border-blue-200",
  "Tenancy Generation": "bg-purple-50 text-purple-700 border-purple-200",
  "Awaiting References": "bg-amber-50 text-amber-700 border-amber-200",
  "Signing and Move in Monies": "bg-green-50 text-green-700 border-green-200",
};

function StatusChip({ status }: { status: string }) {
  const cls = STATUS_CHIP[status] ?? "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {status}
    </span>
  );
}

/* ------------------------------ table columns ------------------------------ */

const MOVE_IN_COLUMNS: DataTableColumn<MoveInRow & Record<string, unknown>>[] = [
  { key: "agent", label: "Agent" },
  { key: "property", label: "Property" },
  { key: "moveInDate", label: "Move-in" },
  { key: "letType", label: "Let type" },
  { key: "serviceLevel", label: "Service level" },
  { key: "rentPcm", label: "Rent pcm", align: "right", render: (r) => formatGBP(r.rentPcm) },
  { key: "setupFee", label: "Set-up fee", align: "right", render: (r) => formatGBP(r.setupFee) },
  { key: "monthlyMgmtFee", label: "Mgmt fee /mo", align: "right", render: (r) => formatGBP(r.monthlyMgmtFee) },
  { key: "twelveMonthValue", label: "12M value", align: "right", render: (r) => formatGBP(r.twelveMonthValue) },
];

const PIPELINE_COLUMNS: DataTableColumn<PipelineRow & Record<string, unknown>>[] = [
  { key: "agent", label: "Agent" },
  { key: "property", label: "Property" },
  { key: "expectedMoveIn", label: "Expected move-in" },
  { key: "serviceLevel", label: "Service level" },
  { key: "status", label: "Status", render: (r) => <StatusChip status={r.status} /> },
  { key: "rentPcm", label: "Rent pcm", align: "right", render: (r) => formatGBP(r.rentPcm) },
];

/* --------------------------------- the tab --------------------------------- */

export default function MoveInsTab({ month }: { month: string }) {
  const h = SEED.moveInHeader;
  const isSnapshotMonth = month === "2026-07";

  // Manual override of July MTD completed move-ins (admin correction)
  const [override, setOverride] = useState<ManualOverride | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formValue, setFormValue] = useState("");
  const [formNote, setFormNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOverrides = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/actuals?month=${encodeURIComponent(month)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data: unknown = await res.json();
      const list: ActualOverride[] = Array.isArray(data)
        ? (data as ActualOverride[])
        : ((data as { overrides?: ActualOverride[] })?.overrides ?? []);
      const row = list.find(
        (o) => o.scope === "business" && o.metric === "funnel.moveIns"
      );
      setOverride(row ? { value: row.value, note: row.note } : null);
    } catch {
      /* offline / route not ready — snapshot figures still render */
    }
  }, [month]);

  useEffect(() => {
    void loadOverrides();
  }, [loadOverrides]);

  async function saveOverride() {
    const value = Number(formValue);
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter a valid move-in count.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/actuals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "business",
          month,
          metric: "funnel.moveIns",
          value,
          note: formNote.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setOverride({ value, note: formNote.trim() || undefined });
      setFormOpen(false);
      setFormValue("");
      setFormNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // Completed move-ins: manual override (if keyed in) beats snapshot.
  const completed: StatValue = resolveStat(
    null,
    override,
    h.julyMtdCompleted
  );

  return (
    <div className="space-y-6">
      {!isSnapshotMonth ? (
        <div className="rounded-2xl border border-line bg-card px-4 py-3 text-[13px] text-muted">
          Snapshot data covers July 2026 — tables below are from the 11 Jul
          2026 capture, not {monthLabel(month)}.
        </div>
      ) : null}

      {/* Header stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Completed (Jul MTD)"
          stat={completed}
          sub="6 new lets + 4 relets"
          big
        />
        <StatCard label="Remaining in July pipeline" stat={h.julyRemainingPipeline} />
        <StatCard label="July forecast" stat={h.julyForecast} sub="10 completed + 26 remaining" />
        <StatCard label="Aug–Sep pipeline" stat={h.augSepPipeline} />
        <StatCard label="Q2 move-ins" stat={h.q2TotalMoveIns} sub="Apr 20 + May 60 + Jun 30" />
        <StatCard label="YTD move-ins" stat={h.ytdMoveIns} sub="Q1 65 + Q2 110 + Jul 10" />
      </div>

      {/* Admin correction */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Add / correct July move-ins</h2>
            <p className="mt-0.5 text-xs text-muted">
              Adjusts the completed move-in count (shown above with a MANUAL
              badge) — the snapshot table itself stays as captured.
            </p>
          </div>
          {!formOpen ? (
            <button
              type="button"
              onClick={() => {
                setFormValue(String(override?.value ?? completed.value ?? ""));
                setFormNote(override?.note ?? "");
                setFormOpen(true);
              }}
              className="btn-press rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white"
            >
              Add move-in
            </button>
          ) : null}
        </div>

        {formOpen ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                New completed count
              </span>
              <input
                type="number"
                min={0}
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                className="mt-1 block w-36 rounded-lg border border-line bg-card px-3 py-2 text-sm tnum focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block grow">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Note (what changed)
              </span>
              <input
                type="text"
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                placeholder="e.g. +1 move-in completed 12 Jul — 14 The Avenue"
                className="mt-1 block w-full min-w-56 rounded-lg border border-line bg-card px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveOverride()}
                disabled={saving}
                className="btn-press rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFormOpen(false);
                  setError(null);
                }}
                className="btn-press rounded-full border border-line px-4 py-2 text-[13px] font-semibold"
              >
                Cancel
              </button>
            </div>
            {error ? (
              <p className="w-full text-xs text-accent">{error}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* July move-ins table */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            July 2026 move-ins — {SEED.moveInsJuly.rows.length} completed
          </h2>
          <SourceBadge
            source={SEED.moveInsJuly.totalTwelveMonthValue.source}
            note={SEED.moveInsJuly.totalTwelveMonthValue.note}
            asOf={SEED.moveInsJuly.totalTwelveMonthValue.asOf}
          />
        </div>
        <DataTable columns={MOVE_IN_COLUMNS} rows={SEED.moveInsJuly.rows} compact />
        <p className="text-right text-[13px] font-semibold tnum">
          Total 12-month value:{" "}
          {SEED.moveInsJuly.totalTwelveMonthValue.display ?? "—"}
        </p>
      </section>

      {/* July pipeline */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          July pipeline — {SEED.julyPipeline.length} properties expected this month
        </h2>
        <DataTable columns={PIPELINE_COLUMNS} rows={SEED.julyPipeline} compact />
      </section>

      {/* Forward pipeline */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          Forward pipeline (Aug–Sep) — {SEED.forwardPipeline.length} properties
        </h2>
        <DataTable columns={PIPELINE_COLUMNS} rows={SEED.forwardPipeline} compact />
      </section>
    </div>
  );
}
