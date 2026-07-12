"use client";

import { useState } from "react";
import { monthLabel } from "@/lib/format";

// A flexible period selector for the earnings view: preset windows, a
// jump-to-month picker, and a custom from/to range. Because the underlying
// figures are monthly, every selection resolves to a set of month keys — the
// dashboard aggregates whatever months fall in the window.

export interface ResolvedPeriod {
  key: string;
  label: string; // human label, e.g. "Year to date", "Apr–Jun 2026"
  months: string[]; // "2026-04", … (inclusive)
  forecastMonth: string; // the month whose target the graph handle edits
}

const YEAR = 2026;
const ANCHOR = "2026-07"; // latest month covered by the current snapshot
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ALL_MONTHS = SHORT.map((_, i) => `${YEAR}-${String(i + 1).padStart(2, "0")}`);

const idx = (m: string) => Number(m.slice(5, 7)) - 1;
const key = (i: number) => `${YEAR}-${String(i + 1).padStart(2, "0")}`;

function range(fromIdx: number, toIdx: number): string[] {
  const a = Math.max(0, Math.min(fromIdx, toIdx));
  const b = Math.min(11, Math.max(fromIdx, toIdx));
  const out: string[] = [];
  for (let i = a; i <= b; i++) out.push(key(i));
  return out;
}

function rangeLabel(months: string[]): string {
  if (months.length === 0) return "—";
  if (months.length === 1) return monthLabel(months[0]);
  const a = idx(months[0]);
  const b = idx(months[months.length - 1]);
  return `${SHORT[a]}–${SHORT[b]} ${YEAR}`;
}

/** Build each preset relative to the snapshot anchor month. */
export function resolvePreset(key: string, selectedMonth = ANCHOR): ResolvedPeriod {
  const a = idx(ANCHOR);
  switch (key) {
    case "this-month":
      return { key, label: "This month", months: [ANCHOR], forecastMonth: ANCHOR };
    case "last-3m":
      return { key, label: "Last 3 months", months: range(a - 2, a), forecastMonth: ANCHOR };
    case "last-6m":
      return { key, label: "Last 6 months", months: range(a - 5, a), forecastMonth: ANCHOR };
    case "ytd":
      return { key, label: "Year to date", months: range(0, a), forecastMonth: ANCHOR };
    case "full-year":
      return { key, label: "Full year", months: range(0, 11), forecastMonth: ANCHOR };
    case "by-month":
      return { key, label: monthLabel(selectedMonth), months: [selectedMonth], forecastMonth: selectedMonth };
    default:
      return { key: "ytd", label: "Year to date", months: range(0, a), forecastMonth: ANCHOR };
  }
}

const PRESETS = [
  { key: "this-month", label: "This month" },
  { key: "last-3m", label: "Last 3 months" },
  { key: "last-6m", label: "Last 6 months" },
  { key: "ytd", label: "Year to date" },
  { key: "full-year", label: "Full year" },
] as const;

export default function PeriodPicker({
  value,
  onChange,
}: {
  value: ResolvedPeriod;
  onChange: (p: ResolvedPeriod) => void;
}) {
  const [mode, setMode] = useState<"preset" | "month" | "custom">("preset");
  const [selectedMonth, setSelectedMonth] = useState(ANCHOR);
  const [from, setFrom] = useState("2026-04");
  const [to, setTo] = useState(ANCHOR);

  const pill = (active: boolean) =>
    `whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition ${
      active
        ? "border-accent bg-accent text-white"
        : "hairline border-line bg-card text-muted hover:text-ink"
    }`;

  function pickPreset(key: string) {
    setMode("preset");
    onChange(resolvePreset(key));
  }

  function pickMonth(m: string) {
    setSelectedMonth(m);
    setMode("month");
    onChange({ key: "by-month", label: monthLabel(m), months: [m], forecastMonth: m });
  }

  function applyCustom(nextFrom: string, nextTo: string) {
    const months = range(idx(nextFrom), idx(nextTo));
    onChange({
      key: "custom",
      label: rangeLabel(months),
      months,
      forecastMonth: months.length ? months[months.length - 1] : ANCHOR,
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={pill(mode === "preset" && value.key === p.key)}
            onClick={() => pickPreset(p.key)}
          >
            {p.label}
          </button>
        ))}

        {/* By month */}
        <select
          value={mode === "month" ? selectedMonth : ""}
          onChange={(e) => e.target.value && pickMonth(e.target.value)}
          className={`${pill(mode === "month")} appearance-none pr-6`}
          aria-label="Jump to a month"
        >
          <option value="" disabled>
            By month…
          </option>
          {ALL_MONTHS.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>

        {/* Custom range toggle */}
        <button
          type="button"
          className={pill(mode === "custom")}
          onClick={() => {
            setMode("custom");
            applyCustom(from, to);
          }}
        >
          Custom range
        </button>
      </div>

      {mode === "custom" ? (
        <div className="fade-up flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <span>From</span>
          <input
            type="month"
            min="2026-01"
            max="2026-12"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              applyCustom(e.target.value, to);
            }}
            className="hairline rounded-lg border border-line bg-card px-2.5 py-1.5 text-ink outline-none focus:border-accent"
          />
          <span>to</span>
          <input
            type="month"
            min="2026-01"
            max="2026-12"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              applyCustom(from, e.target.value);
            }}
            className="hairline rounded-lg border border-line bg-card px-2.5 py-1.5 text-ink outline-none focus:border-accent"
          />
        </div>
      ) : null}
    </div>
  );
}
