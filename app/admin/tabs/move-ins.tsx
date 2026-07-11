"use client";

// Admin tab: Move-ins & pipeline — header stats, July move-ins table (10 rows),
// July pipeline (26 rows), forward pipeline Aug–Sep (25 rows).
// Admin can ADD a move-in: the row (agent/property/date/rent/fees) is stored in
// the actuals-store (metric "moveIns.row.<id>", row JSON in the note) and is
// merged with the snapshot table, per the spec. The completed count reflects
// snapshot + added rows (or an explicit "funnel.moveIns" count override).

import { useCallback, useEffect, useMemo, useState } from "react";
import StatCard from "@/components/StatCard";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import SourceBadge from "@/components/SourceBadge";
import type { SeedData } from "@/lib/seed-data"; // type-only — erased at build
import { ROSTER } from "@/lib/roster";
import type { PipelineRow, MoveInRow } from "@/lib/seed-types";
import { resolveStat, type ManualOverride } from "@/lib/stats";
import { formatDate, formatGBP, monthLabel } from "@/lib/format";
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

type MoveInTableRow = MoveInRow & { added?: boolean } & Record<string, unknown>;

const MOVE_IN_COLUMNS: DataTableColumn<MoveInTableRow>[] = [
  {
    key: "agent",
    label: "Agent",
    render: (r) => (
      <span>
        {r.agent}
        {r.added ? (
          <span className="ml-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[9px] font-semibold text-amber-700">
            ADDED
          </span>
        ) : null}
      </span>
    ),
  },
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

/* --------------------------- added-row (de)serialising --------------------------- */

const ROW_METRIC_PREFIX = "moveIns.row.";

/** Parse an actuals-store override back into a move-in row (JSON in the note). */
function overrideToRow(o: ActualOverride): MoveInRow | null {
  if (!o.metric.startsWith(ROW_METRIC_PREFIX) || !o.note) return null;
  try {
    const parsed = JSON.parse(o.note) as Partial<MoveInRow>;
    if (!parsed || typeof parsed.agent !== "string" || typeof parsed.property !== "string") {
      return null;
    }
    return {
      agent: parsed.agent,
      property: parsed.property,
      applicationDate: parsed.applicationDate ?? null,
      moveInDate: parsed.moveInDate ?? "",
      letType: parsed.letType === "Relet" ? "Relet" : "New Let",
      serviceLevel: typeof parsed.serviceLevel === "string" ? parsed.serviceLevel : "Tenant Find",
      rentPcm: Number(parsed.rentPcm) || 0,
      setupFee: Number(parsed.setupFee) || 0,
      monthlyMgmtFee: Number(parsed.monthlyMgmtFee) || 0,
      twelveMonthValue: Number(parsed.twelveMonthValue) || 0,
    };
  } catch {
    return null;
  }
}

/* --------------------------------- the tab --------------------------------- */

export default function MoveInsTab({ month, seed }: { month: string; seed: SeedData }) {
  const h = seed.moveInHeader;
  const isSnapshotMonth = month === "2026-07";

  // Admin-added move-in rows + optional explicit count override for the month.
  const [addedRows, setAddedRows] = useState<MoveInRow[]>([]);
  const [countOverride, setCountOverride] = useState<ManualOverride | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add-a-move-in form fields
  const [fAgent, setFAgent] = useState("");
  const [fProperty, setFProperty] = useState("");
  const [fDate, setFDate] = useState("");
  const [fLetType, setFLetType] = useState<"New Let" | "Relet">("New Let");
  const [fService, setFService] = useState("Tenant Find");
  const [fRent, setFRent] = useState("");
  const [fSetup, setFSetup] = useState("");
  const [fMgmt, setFMgmt] = useState("");

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
      const count = list.find(
        (o) => o.scope === "business" && o.metric === "funnel.moveIns"
      );
      setCountOverride(count ? { value: count.value, note: count.note } : null);
      setAddedRows(
        list
          .filter((o) => o.scope === "business")
          .map(overrideToRow)
          .filter((r): r is MoveInRow => r !== null)
      );
    } catch {
      /* offline / route not ready — snapshot figures still render */
    }
  }, [month]);

  useEffect(() => {
    void loadOverrides();
  }, [loadOverrides]);

  async function saveMoveIn() {
    const rent = Number(fRent);
    const setup = fSetup.trim() === "" ? 0 : Number(fSetup);
    const mgmt = fMgmt.trim() === "" ? 0 : Number(fMgmt);
    if (!fAgent) {
      setError("Pick the agent for this move-in.");
      return;
    }
    if (!fProperty.trim()) {
      setError("Enter the property.");
      return;
    }
    if (!Number.isFinite(rent) || rent < 0) {
      setError("Enter a valid rent (pcm).");
      return;
    }
    if (!Number.isFinite(setup) || setup < 0 || !Number.isFinite(mgmt) || mgmt < 0) {
      setError("Fees must be 0 or more.");
      return;
    }
    const row: MoveInRow = {
      agent: fAgent,
      property: fProperty.trim(),
      applicationDate: null,
      moveInDate: fDate ? formatDate(fDate) : monthLabel(month),
      letType: fLetType,
      serviceLevel: fService,
      rentPcm: rent,
      setupFee: setup,
      monthlyMgmtFee: mgmt,
      twelveMonthValue: Math.round(setup + mgmt * 12),
    };
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/actuals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "business",
          month,
          metric: `${ROW_METRIC_PREFIX}${Date.now()}`,
          value: rent,
          note: JSON.stringify(row),
        }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setAddedRows((prev) => [...prev, row]);
      setFormOpen(false);
      setFAgent("");
      setFProperty("");
      setFDate("");
      setFRent("");
      setFSetup("");
      setFMgmt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // Completed move-ins: explicit count override wins; otherwise snapshot count
  // plus any rows the admin has added through the portal.
  const completed: StatValue = useMemo(() => {
    const base = resolveStat(null, countOverride, h.julyMtdCompleted);
    if (countOverride == null && addedRows.length > 0 && base.value != null) {
      return {
        value: base.value + addedRows.length,
        source: "manual",
        note: `${base.value} from the 11 Jul 2026 snapshot + ${addedRows.length} added in the portal for ${monthLabel(month)}`,
      };
    }
    return base;
  }, [countOverride, addedRows, h.julyMtdCompleted, month]);

  const moveInTableRows: MoveInTableRow[] = [
    ...(seed.moveInsJuly.rows as MoveInTableRow[]),
    ...addedRows.map((r) => ({ ...r, added: true }) as MoveInTableRow),
  ];

  const addedTwelveMonthValue = addedRows.reduce(
    (s, r) => s + r.twelveMonthValue,
    0
  );

  const inputClass =
    "mt-1 block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm focus:border-accent focus:outline-none";

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

      {/* Add a move-in */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Add a move-in</h2>
            <p className="mt-0.5 text-xs text-muted">
              Adds a row to the move-ins table for {monthLabel(month)} (marked
              ADDED, stored as a manual actual) and bumps the completed count —
              the snapshot rows themselves stay as captured.
            </p>
          </div>
          {!formOpen ? (
            <button
              type="button"
              onClick={() => {
                setFormOpen(true);
                setError(null);
              }}
              className="btn-press rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white"
            >
              Add move-in
            </button>
          ) : null}
        </div>

        {formOpen ? (
          <div className="mt-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Agent
                </span>
                <select
                  value={fAgent}
                  onChange={(e) => setFAgent(e.target.value)}
                  className={inputClass}
                >
                  <option value="">— Pick an agent —</option>
                  {ROSTER.filter((r) => r.active).map((r) => (
                    <option key={r.agentKey} value={r.displayName}>
                      {r.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Property
                </span>
                <input
                  type="text"
                  value={fProperty}
                  onChange={(e) => setFProperty(e.target.value)}
                  placeholder="e.g. 14 The Avenue"
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Move-in date
                </span>
                <input
                  type="date"
                  value={fDate}
                  onChange={(e) => setFDate(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Let type
                </span>
                <select
                  value={fLetType}
                  onChange={(e) => setFLetType(e.target.value === "Relet" ? "Relet" : "New Let")}
                  className={inputClass}
                >
                  <option value="New Let">New Let</option>
                  <option value="Relet">Relet</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Service level
                </span>
                <select
                  value={fService}
                  onChange={(e) => setFService(e.target.value)}
                  className={inputClass}
                >
                  <option value="Tenant Find">Tenant Find</option>
                  <option value="EFM no RLP">EFM no RLP</option>
                  <option value="EFM with RLP">EFM with RLP</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Rent pcm (£)
                </span>
                <input
                  type="number"
                  min={0}
                  value={fRent}
                  onChange={(e) => setFRent(e.target.value)}
                  className={`${inputClass} tnum`}
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Set-up fee (£)
                </span>
                <input
                  type="number"
                  min={0}
                  value={fSetup}
                  onChange={(e) => setFSetup(e.target.value)}
                  className={`${inputClass} tnum`}
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Mgmt fee /mo (£)
                </span>
                <input
                  type="number"
                  min={0}
                  value={fMgmt}
                  onChange={(e) => setFMgmt(e.target.value)}
                  className={`${inputClass} tnum`}
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void saveMoveIn()}
                disabled={saving}
                className="btn-press rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save move-in"}
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
              {error ? <p className="text-xs text-accent">{error}</p> : null}
            </div>
          </div>
        ) : null}
      </section>

      {/* July move-ins table (snapshot + admin-added rows) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            July 2026 move-ins — {seed.moveInsJuly.rows.length} completed
            {addedRows.length > 0 ? ` + ${addedRows.length} added` : ""}
          </h2>
          <SourceBadge
            source={seed.moveInsJuly.totalTwelveMonthValue.source}
            note={seed.moveInsJuly.totalTwelveMonthValue.note}
            asOf={seed.moveInsJuly.totalTwelveMonthValue.asOf}
          />
        </div>
        <DataTable columns={MOVE_IN_COLUMNS} rows={moveInTableRows} compact />
        <p className="text-right text-[13px] font-semibold tnum">
          Total 12-month value:{" "}
          {addedRows.length > 0 && seed.moveInsJuly.totalTwelveMonthValue.value != null
            ? formatGBP(
                seed.moveInsJuly.totalTwelveMonthValue.value + addedTwelveMonthValue
              )
            : seed.moveInsJuly.totalTwelveMonthValue.display ?? "—"}
        </p>
      </section>

      {/* July pipeline */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          July pipeline — {seed.julyPipeline.length} properties expected this month
        </h2>
        <DataTable columns={PIPELINE_COLUMNS} rows={seed.julyPipeline} compact />
      </section>

      {/* Forward pipeline */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          Forward pipeline (Aug–Sep) — {seed.forwardPipeline.length} properties
        </h2>
        <DataTable columns={PIPELINE_COLUMNS} rows={seed.forwardPipeline} compact />
      </section>
    </div>
  );
}
