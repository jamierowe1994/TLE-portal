"use client";

// Admin tab: P&L — grid built on the H2 2026 reforecast structure (Jul–Dec).
// The Base44 P&L tab is password-protected, so this grid IS the working P&L:
// July cells are click-to-edit; edits write manual overrides to
// /api/admin/actuals (metric "pnl.<lineKey>.2026-07") and show a MANUAL badge.

import { useCallback, useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import SourceBadge from "@/components/SourceBadge";
import type { SeedData } from "@/lib/seed-data"; // type-only — erased at build
import { SNAPSHOT_DATE } from "@/lib/roster";
import type { H2ReforecastRow } from "@/lib/seed-types";
import { formatGBP, formatNum, formatPct } from "@/lib/format";
import type { ActualOverride } from "@/lib/types";

// The editable column is July 2026 — fixed, this grid is the H2 2026 plan.
const PNL_MONTH = "2026-07";

function formatCell(row: H2ReforecastRow, value: number): string {
  if (row.kind === "currency") return formatGBP(value);
  if (row.kind === "pct") return formatPct(value, 1);
  return formatNum(value);
}

export default function PnlTab({ month, seed }: { month: string; seed: SeedData }) {
  void month; // grid always shows the H2 2026 reforecast (Jul–Dec)
  const rf = seed.h2Reforecast;

  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOverrides = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/actuals?month=${encodeURIComponent(PNL_MONTH)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data: unknown = await res.json();
      const list: ActualOverride[] = Array.isArray(data)
        ? (data as ActualOverride[])
        : ((data as { overrides?: ActualOverride[] })?.overrides ?? []);
      const map: Record<string, number> = {};
      for (const o of list) {
        const m = /^pnl\.([A-Za-z0-9]+)\.(\d{4}-\d{2})$/.exec(o.metric);
        if (m && m[2] === PNL_MONTH && o.scope === "business") {
          map[m[1]] = o.value;
        }
      }
      setOverrides(map);
    } catch {
      /* route not ready / offline — reforecast figures still render */
    }
  }, []);

  useEffect(() => {
    void loadOverrides();
  }, [loadOverrides]);

  function startEdit(row: H2ReforecastRow) {
    setEditingKey(row.key);
    setEditValue(String(overrides[row.key] ?? row.values[0]));
    setError(null);
  }

  async function saveEdit(row: H2ReforecastRow) {
    const value = Number(editValue);
    if (!Number.isFinite(value)) {
      setError("Enter a valid number.");
      return;
    }
    setSavingKey(row.key);
    setError(null);
    try {
      const res = await fetch("/api/admin/actuals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "business",
          month: PNL_MONTH,
          metric: `pnl.${row.key}.${PNL_MONTH}`,
          value,
          note: `P&L manual entry — ${row.label}, Jul 2026`,
        }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setOverrides((prev) => ({ ...prev, [row.key]: value }));
      setEditingKey(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Source note */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
        <span className="font-semibold">Base44 P&amp;L tab is password-protected</span>{" "}
        — structure from the H2 reforecast (19 Nov 25 draft); figures are
        editable here. Click any July cell to key in an actual.
      </div>

      {/* Hero cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="H2 2026 net loss (forecast)" stat={rf.h2NetLoss} big />
        <StatCard label="Cumulative YTD at Dec" stat={rf.cumulativeYtdDec} big />
        <div className="card relative p-5">
          <div className="absolute right-4 top-4">
            <SourceBadge source="snapshot" note={rf.sourceNote} asOf={SNAPSHOT_DATE} />
          </div>
          <div className="stat-label pr-16 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Break-even
          </div>
          <div className="stat-value mt-2 text-[24px]">Not in 2026</div>
          <div className="mt-1.5 text-xs text-muted">
            Needs ~500+ managed properties at the current cost structure
          </div>
        </div>
      </div>

      {/* P&L grid */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            H2 2026 P&amp;L — Jul to Dec (Jul column editable)
          </h2>
          <SourceBadge source="snapshot" note={rf.sourceNote} asOf={SNAPSHOT_DATE} />
        </div>
        {error ? <p className="text-xs text-accent">{error}</p> : null}
        <div className="card overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 border-b border-line bg-card px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  P&amp;L line
                </th>
                {rf.months.map((m, i) => (
                  <th
                    key={m}
                    className={`sticky top-0 z-10 border-b border-line bg-card px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide ${
                      i === 0 ? "text-accent" : "text-muted"
                    }`}
                  >
                    {m}
                    {i === 0 ? " ✎" : ""}
                  </th>
                ))}
                <th className="sticky top-0 z-10 border-b border-line bg-card px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted">
                  H2 total
                </th>
              </tr>
            </thead>
            <tbody>
              {rf.rows.map((row) => {
                const overridden = overrides[row.key] != null;
                const julValue = overrides[row.key] ?? row.values[0];
                const isEditing = editingKey === row.key;
                const emphasis =
                  row.key === "totalIncome" ||
                  row.key === "grossProfit" ||
                  row.key === "netProfit";
                return (
                  <tr
                    key={row.key}
                    className="border-b border-line/60 last:border-b-0 hover:bg-gray-50/60"
                  >
                    <td
                      className={`px-3.5 py-2 ${emphasis ? "font-semibold" : ""}`}
                    >
                      {row.label}
                    </td>
                    {/* July — editable */}
                    <td className="px-3.5 py-2 text-right tnum">
                      {isEditing ? (
                        <input
                          autoFocus
                          type="number"
                          step="any"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveEdit(row);
                            if (e.key === "Escape") setEditingKey(null);
                          }}
                          onBlur={() => setEditingKey(null)}
                          disabled={savingKey === row.key}
                          className="w-28 rounded-md border border-accent bg-card px-2 py-1 text-right text-[13px] tnum focus:outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          title="Click to key in the July actual"
                          className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 tnum hover:bg-accent-soft ${
                            emphasis ? "font-semibold" : ""
                          }`}
                        >
                          {formatCell(row, julValue)}
                          {overridden ? (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-1 py-px text-[9px] font-semibold text-amber-700">
                              MANUAL
                            </span>
                          ) : null}
                        </button>
                      )}
                    </td>
                    {/* Aug–Dec — reforecast */}
                    {row.values.slice(1).map((v, i) => (
                      <td
                        key={i}
                        className={`px-3.5 py-2 text-right tnum ${
                          emphasis ? "font-semibold" : ""
                        }`}
                      >
                        {formatCell(row, v)}
                      </td>
                    ))}
                    <td
                      className={`px-3.5 py-2 text-right tnum font-semibold`}
                    >
                      {formatCell(row, row.h2Total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          {rf.assumptions} · {rf.breakEvenNote}
        </p>
      </section>
    </div>
  );
}
