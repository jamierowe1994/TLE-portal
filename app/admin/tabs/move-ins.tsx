"use client";

// Admin tab: Move-ins & pipeline — header stats, July move-ins table (10 rows),
// July pipeline (26 rows), forward pipeline Aug–Sep (25 rows).
// Admin can ADD a move-in: the row (agent/property/date/rent/fees) is stored in
// the actuals-store (metric "moveIns.row.<id>", row JSON in the note) and is
// merged with the snapshot table, per the spec. The completed count reflects
// snapshot + added rows (or an explicit "funnel.moveIns" count override).

import { useCallback, useEffect, useMemo, useState } from "react";
import StatCard from "@/components/StatCard";
import SourceNote from "@/components/SourceNote";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import SourceBadge from "@/components/SourceBadge";
import type { SeedData } from "@/lib/seed-data"; // type-only — erased at build
import { ROSTER } from "@/lib/roster";
import type { PipelineRow, MoveInRow } from "@/lib/seed-types";
import { resolveStat, type ManualOverride } from "@/lib/stats";
import { currentMonth, formatDate, formatGBP, monthLabel, recentMonths } from "@/lib/format";
import type { ActualOverride, StatValue } from "@/lib/types";
const SNAPSHOT_MONTH = "2026-07"; // the one month the seed answers for

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

interface LiveRows {
  configured?: boolean;
  moveIns: Array<{
    id: string;
    agent: string | null;
    address: string;
    moveIn: string;
    service: string | null;
    rentPcm: number | null;
  }> | null;
  pipeline: Array<{
    id: string;
    agent: string | null;
    property: string;
    locality: string;
    expected: string | null;
    service: string | null;
    status: string;
    rentPcm: number | null;
  }> | null;
}

/** Propoly's own words, tidied. Never invented — an unknown level shows raw. */
const SERVICE = (s: string | null) =>
  s == null
    ? "—"
    : s === "full_managed"
      ? "Fully managed"
      : s === "tenant_find"
        ? "Tenant find"
        : s === "rent_collect"
          ? "Rent collect"
          : s;

const LIVE_MOVE_IN_COLUMNS = [
  { key: "agent", label: "Agent", render: (r: Record<string, unknown>) => (r.agent as string) ?? "—" },
  { key: "address", label: "Property" },
  {
    key: "moveIn",
    label: "Move-in",
    render: (r: Record<string, unknown>) => formatDate(r.moveIn as string),
  },
  {
    key: "service",
    label: "Service level",
    render: (r: Record<string, unknown>) => SERVICE(r.service as string | null),
  },
  {
    key: "rentPcm",
    label: "Rent pcm",
    align: "right" as const,
    render: (r: Record<string, unknown>) =>
      r.rentPcm == null ? "—" : formatGBP(r.rentPcm as number),
  },
];

const LIVE_PIPELINE_COLUMNS = [
  { key: "agent", label: "Agent", render: (r: Record<string, unknown>) => (r.agent as string) ?? "—" },
  {
    key: "property",
    label: "Property",
    render: (r: Record<string, unknown>) =>
      [r.property, r.locality].filter(Boolean).join(", ") || "—",
  },
  {
    key: "expected",
    label: "Expected move-in",
    render: (r: Record<string, unknown>) =>
      r.expected ? formatDate(r.expected as string) : "TBC",
  },
  {
    key: "service",
    label: "Service level",
    render: (r: Record<string, unknown>) => SERVICE(r.service as string | null),
  },
  { key: "status", label: "Status" },
  {
    key: "rentPcm",
    label: "Rent pcm",
    align: "right" as const,
    render: (r: Record<string, unknown>) =>
      r.rentPcm == null ? "—" : formatGBP(r.rentPcm as number),
  },
];

/* --------------------------------- the tab --------------------------------- */

interface PropolyBiz {
  month: string;
  pipelineTotal: number;
  pipelineByStage: { key: string; label: string; count: number }[];
  moveInsThisMonth: number;
  generatedAt: string;
}

interface MoveInTracker {
  completedMtd: number;
  completedPrevMtd: number;
  forecastByMonth: Record<string, number>;
  forecastOverdue: number;
  forecastUndated: number;
  pipelineTotal: number;
  completedByMonth: Record<string, number>;
  ytd: number;
  prevYtd: number;
  generatedAt: string;
}

/** Green up / red down arrow with the % change vs a comparison figure. */
function Trend({ curr, prev, vs }: { curr: number; prev: number; vs: string }) {
  if (prev <= 0) return null;
  const pct = Math.round(((curr - prev) / prev) * 100);
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${up ? "text-green-600" : "text-red-600"}`}
      title={`${vs}: ${prev}`}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        {up ? (
          <path d="M5 1l4 6H1z" fill="currentColor" />
        ) : (
          <path d="M5 9L1 3h8z" fill="currentColor" />
        )}
      </svg>
      {up ? "+" : ""}
      {pct}%
      <span className="font-normal text-muted">&nbsp;vs {vs.toLowerCase()}</span>
    </span>
  );
}

const MONTH_NAME = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });

export default function MoveInsTab({ month, seed }: { month: string; seed: SeedData }) {
  const h = seed.moveInHeader;

  /* The two tables, live from Propoly, on their own month.
     They have their own picker rather than following the tab's: the tab reports
     the last COMPLETE month, but "who moved in this month so far" is a question
     people ask about the month they are standing in. Defaulting the tables to
     the tab's month and giving them a toggle serves both without either being
     wrong. */
  /* These open on the CURRENT month, not the tab's.
     The tab reports the last complete month, which is right for counting
     finished work. But "who is moving in this month, and who has already"
     is a question about the month we are standing in — answering it with July
     on the 18th of August is answering a different question. The toggle still
     reaches back. */
  const [tableMonth, setTableMonth] = useState(currentMonth);
  const [rows, setRows] = useState<LiveRows | null>(null);
  const [rowsLoading, setRowsLoading] = useState(true);
  useEffect(() => {
    let off = false;
    setRowsLoading(true);
    fetch(`/api/admin/move-in-rows?month=${encodeURIComponent(tableMonth)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LiveRows | null) => {
        if (!off) setRows(d);
      })
      .catch(() => {
        if (!off) setRows(null);
      })
      .finally(() => {
        if (!off) setRowsLoading(false);
      });
    return () => {
      off = true;
    };
  }, [tableMonth]);

  // Admin-added move-in rows + optional explicit count override for the month.
  const [addedRows, setAddedRows] = useState<MoveInRow[]>([]);
  const [countOverride, setCountOverride] = useState<ManualOverride | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Move-in tracker — completed MTD, forward forecast + rollups with trends.
  const [tracker, setTracker] = useState<MoveInTracker | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/move-in-tracker", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setTracker((j as { tracker?: MoveInTracker | null }).tracker ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Live Propoly strip — the true progression pipeline + completed move-ins.
  const [livePropoly, setLivePropoly] = useState<PropolyBiz | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/live-business?month=${encodeURIComponent(month)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setLivePropoly((j as { propoly?: PropolyBiz | null }).propoly ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [month]);

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


  const addedTwelveMonthValue = addedRows.reduce(
    (s, r) => s + r.twelveMonthValue,
    0
  );

  const inputClass =
    "mt-1 block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm focus:border-accent focus:outline-none";

  return (
    <div className="space-y-6">
      {/* ---- LIVE from Propoly: the true progression picture, today ---- */}
      {livePropoly ? (
        <section className="card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide">
              Live progression — Propoly
            </h2>
            <SourceBadge
              source="live-propoly"
              note="Live from Propoly tenancy progression — the whole business, refreshed every minute or so."
            />
          </div>
          <div className="mt-3 grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
            <StatCard
              size="sm"
              label="Move-ins"
              stat={{
                value: livePropoly.moveInsThisMonth,
                source: "live-propoly",
                note: "Completed Propoly deals with a move-in date this month.",
                asOf: livePropoly.generatedAt.slice(0, 10),
              }}
              sub={`${monthLabel(livePropoly.month).split(" ")[0]} · completed`}
            />
            <StatCard
              size="sm"
              label="In progression"
              stat={{
                value: livePropoly.pipelineTotal,
                source: "live-propoly",
                note: "Every live deal, deal started through signing & move-in monies.",
                asOf: livePropoly.generatedAt.slice(0, 10),
              }}
              sub="All stages"
            />
            {livePropoly.pipelineByStage.map((s) => (
              <StatCard
                key={s.key}
                size="sm"
                label={s.label}
                stat={{
                  value: s.count,
                  source: "live-propoly",
                  asOf: livePropoly.generatedAt.slice(0, 10),
                }}
                sub="Right now"
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* ---- Move-in tracker: MTD + forecast + rollups, with trend arrows ---- */}
      {tracker
        ? (() => {
            const horizon = Object.keys(tracker.forecastByMonth).sort();
            const [m0, m1, m2] = horizon;
            const year = (m0 ?? "2026-07").slice(0, 4);
            const sumMonths = (ms: string[], from: Record<string, number>) =>
              ms.reduce((t, m) => t + (from[m] ?? 0), 0);
            const q3Months = [`${year}-07`, `${year}-08`, `${year}-09`];
            const q2Actual = sumMonths(
              [`${year}-04`, `${year}-05`, `${year}-06`],
              tracker.completedByMonth
            );
            const q3Projected =
              sumMonths(q3Months, tracker.completedByMonth) +
              sumMonths(q3Months, tracker.forecastByMonth);
            const asOf = tracker.generatedAt.slice(0, 10);
            const tiles: Array<{
              label: string;
              value: number;
              sub?: string;
              trend?: { prev: number; vs: string };
            }> = [
              {
                label: "Completed MTD",
                value: tracker.completedMtd,
                sub: "Moved in this month",
                trend: { prev: tracker.completedPrevMtd, vs: "Same point last month" },
              },
              {
                label: `Remaining ${MONTH_NAME(m0)} forecast`,
                value: tracker.forecastByMonth[m0] ?? 0,
                sub: "In progression, move-in date this month",
              },
              {
                label: MONTH_NAME(m1),
                value: tracker.forecastByMonth[m1] ?? 0,
                sub: "Forecast from progression",
              },
              {
                label: MONTH_NAME(m2),
                value: tracker.forecastByMonth[m2] ?? 0,
                sub: "Forecast from progression",
              },
              {
                label: "Pipeline",
                value: tracker.pipelineTotal,
                sub: `${tracker.forecastOverdue} past move-in date · ${tracker.forecastUndated} undated`,
              },
              {
                label: "Q3 projected",
                value: q3Projected,
                sub: "Completed + progression forecast",
                trend: { prev: q2Actual, vs: "Q2 actual" },
              },
              {
                label: "YTD move-ins",
                value: tracker.ytd,
                sub: "1 Jan → today",
                trend: { prev: tracker.prevYtd, vs: "Same window last year" },
              },
            ];
            return (
              <section className="card p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[13px] font-semibold uppercase tracking-wide">
                    Move-in tracker
                  </h2>
                  <SourceBadge
                    source="live-propoly"
                    note="Live from Propoly — completed deals and the forward progression forecast. Susan's Move-In Report also counts managed transfers + marketing-only move-ins."
                    asOf={asOf}
                  />
                </div>
                <div className="mt-3 grid gap-3 grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
                  {tiles.map((t) => (
                    <div key={t.label} className="rounded-xl border border-green-200 bg-white p-3 shadow-sm">
                      <div className="stat-value text-[24px] leading-tight">{t.value}</div>
                      {t.trend ? (
                        <div className="mt-0.5">
                          <Trend curr={t.value} prev={t.trend.prev} vs={t.trend.vs} />
                        </div>
                      ) : null}
                      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide">
                        {t.label}
                      </div>
                      {t.sub ? <div className="mt-0.5 text-[10px] text-muted">{t.sub}</div> : null}
                    </div>
                  ))}
                </div>
              </section>
            );
          })()
        : null}

      {/* A FLOW tab: the month selector genuinely re-queries the source, so
          most figures below really are {monthLabel(month)}. The warning is
          only about the ones still on the seed, which stay badged and dated
          — the old wording condemned the whole tab as stale, including the
          live figures it had just fetched for the selected month. */}
      {month !== SNAPSHOT_MONTH ? (
        <div className="rounded-2xl border border-line bg-card px-4 py-3 text-[13px] text-muted">
          Live figures below are for {monthLabel(month)}. Anything still badged{" "}
          <em>snapshot</em> comes from the 11 Jul 2026 capture and answers for July only —
          it is not {monthLabel(month)}.
        </div>
      ) : null}

      {/* Header stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={`Completed (${monthLabel(month)})`}
          stat={completed}
          sub="6 new lets + 4 relets"
          big
        />
        {/* Removed 18 Aug 2026 (James): "Remaining in July pipeline",
            "July forecast", "Aug–Sep pipeline", "Q2 move-ins" and "YTD move-ins" all named a
            fixed month in their label and carried a hand-typed sub — they were
            answering July whatever the picker said, and would have gone on
            saying July into next year. The tab now reports one month, the last
            complete one, and rolls itself. */}

      </div>

      {/* Add a move-in */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              Add a move-in
              <SourceNote tone="derived">
                Typed here and stored in the portal as a manual actual. It bumps the
                completed count and appends a row marked ADDED — it does not write
                back to Propoly.
              </SourceNote>
            </h2>
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

      {/* Both tables below are the 11 Jul capture, not a live feed — say so
          plainly, and loudly when the month selector points elsewhere. */}
      <div
        className={`rounded-2xl border px-4 py-3 text-[13px] ${
          month === "2026-07"
            ? "border-line bg-card text-muted"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}
      >
        {month === "2026-07" ? (
          <>
            The two tables below are the <span className="font-semibold">11 Jul 2026 capture</span>{" "}
            of Propoly, listing individual properties. They are not live, and they
            stay on July whatever month is selected above.
          </>
        ) : (
          <>
            <span className="font-semibold">Showing July 2026, not {monthLabel(month)}.</span>{" "}
            These tables are a fixed capture of individual properties from 11 Jul
            2026 and don&rsquo;t follow the month selector.
          </>
        )}
      </div>

      {/* ── The two tables, live from Propoly, with their own month ──────────
          They were a capture taken on 11 Jul 2026, which is why they sat on
          July whatever was picked above — and why they disagreed with the
          tracker beside them. The capture holds ten rows; Propoly's answer for
          July is thirty-five, because the capture was taken on the 11th and the
          month carried on. */}
      {/* One month, both halves of it: who has moved in, and who is still to.
          They were separate tables with separate counts, which meant the answer
          to "how many move-ins in August" had to be worked out by the reader. */}
      {rows?.moveIns || rows?.pipeline ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {monthLabel(tableMonth)} — total
              </div>
              <div className="stat-value mt-1 text-[30px]">
                {(rows.moveIns?.length ?? 0) + (rows.pipeline?.length ?? 0)}
              </div>
            </div>
            <div className="text-[13px] text-muted">
              <span className="font-semibold text-ink">{rows.moveIns?.length ?? 0}</span>{" "}
              moved in so far
              <span className="mx-2 text-line">·</span>
              <span className="font-semibold text-ink">{rows.pipeline?.length ?? 0}</span>{" "}
              still expected
            </div>
          </div>
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">
            Moved in — {monthLabel(tableMonth)}
            {rows?.moveIns ? ` · ${rows.moveIns.length}` : ""}
            <SourceNote tone="live">
              Propoly deals with tenancy_status=complete and a move-in date in this
              month. Agent comes from the property&rsquo;s manager in Propoly; a
              property with no manager keeps its row and leaves the agent blank
              rather than dropping a real move-in.
            </SourceNote>
          </h2>
          <div className="flex items-center gap-1.5">
            {recentMonths(6).slice().reverse().map((m: string) => (
              <button
                key={m}
                type="button"
                onClick={() => setTableMonth(m)}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  m === tableMonth
                    ? "border-ink bg-ink text-white"
                    : "border-line text-muted hover:border-ink/40"
                }`}
              >
                {monthLabel(m).split(" ")[0].slice(0, 3)}
              </button>
            ))}
          </div>
        </div>
        {rowsLoading ? (
          <p className="text-xs text-muted">Fetching {monthLabel(tableMonth)} from Propoly…</p>
        ) : rows?.moveIns == null ? (
          <p className="text-xs text-muted">
            Propoly didn&rsquo;t answer. Nothing shown rather than a stale month.
          </p>
        ) : rows.moveIns.length === 0 ? (
          <p className="text-xs text-muted">
            No completed move-ins with a {monthLabel(tableMonth)} date.
          </p>
        ) : (
          <DataTable columns={LIVE_MOVE_IN_COLUMNS} rows={rows.moveIns} compact />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          Still to move in — {monthLabel(tableMonth)}
          {rows?.pipeline ? ` · ${rows.pipeline.length}` : ""}
          <SourceNote tone="live">
            Propoly deals still in progression, expected in this month. Deals with
            no expected date are included rather than hidden — an undated deal is
            still real work, and it shows as TBC.
          </SourceNote>
        </h2>
        {rowsLoading ? (
          <p className="text-xs text-muted">Fetching…</p>
        ) : rows?.pipeline == null ? (
          <p className="text-xs text-muted">Propoly didn&rsquo;t answer.</p>
        ) : rows.pipeline.length === 0 ? (
          <p className="text-xs text-muted">Nothing in progression for {monthLabel(tableMonth)}.</p>
        ) : (
          <DataTable columns={LIVE_PIPELINE_COLUMNS} rows={rows.pipeline} compact />
        )}
      </section>

      {/* The Aug–Sep forward pipeline table is gone: it was the 11 Jul capture,
          and the month toggle above now reaches any month either side, live. */}
    </div>
  );
}
