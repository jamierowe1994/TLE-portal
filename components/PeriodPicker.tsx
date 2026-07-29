"use client";

import { useEffect, useRef, useState } from "react";
import { monthLabel } from "@/lib/format";

// Compact period selector for the earnings view: one dropdown of preset
// windows (default "This month"), a "By month" dropdown beside it, and a
// custom from/to range tucked underneath. Figures are monthly, so every
// selection resolves to a set of month keys the dashboard aggregates.

export interface ResolvedPeriod {
  key: string;
  label: string;
  months: string[];
  forecastMonth: string;
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

export function resolvePreset(presetKey: string): ResolvedPeriod {
  const a = idx(ANCHOR);
  switch (presetKey) {
    case "this-month":
      return { key: presetKey, label: "This month", months: [ANCHOR], forecastMonth: ANCHOR };
    case "last-3m":
      return { key: presetKey, label: "Last 3 months", months: range(a - 2, a), forecastMonth: ANCHOR };
    case "last-6m":
      return { key: presetKey, label: "Last 6 months", months: range(a - 5, a), forecastMonth: ANCHOR };
    case "ytd":
      return { key: presetKey, label: "Year to date", months: range(0, a), forecastMonth: ANCHOR };
    case "full-year":
      return { key: presetKey, label: "Full year", months: range(0, 11), forecastMonth: ANCHOR };
    default:
      return { key: "this-month", label: "This month", months: [ANCHOR], forecastMonth: ANCHOR };
  }
}

const PRESET_MENU = [
  { key: "this-month", label: "This month" },
  { key: "last-3m", label: "Last 3 months" },
  { key: "last-6m", label: "Last 6 months" },
  { key: "ytd", label: "Year to date" },
  { key: "full-year", label: "Full year" },
];

const boxClass = (active: boolean) =>
  `inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium transition ${
    active
      ? "border-ink/40 bg-black/[0.05] text-ink"
      : "hairline border-line bg-card text-muted hover:text-ink"
  }`;

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 6h12M5.5 2v2M10.5 2v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function MonthIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 6h12M5.5 2v2M10.5 2v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="4.5" y="8" width="2.4" height="2.4" rx="0.5" fill="currentColor" />
    </svg>
  );
}
function Chevron({ open }: { open?: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }}
    >
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function PeriodPicker({
  value,
  onChange,
}: {
  value: ResolvedPeriod;
  onChange: (p: ResolvedPeriod) => void;
}) {
  const [mode, setMode] = useState<"preset" | "month" | "custom">("preset");
  const [presetKey, setPresetKey] = useState("this-month");
  const [selectedMonth, setSelectedMonth] = useState(ANCHOR);
  const [from, setFrom] = useState("2026-04");
  const [to, setTo] = useState(ANCHOR);
  const [openMenu, setOpenMenu] = useState<"preset" | "month" | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  // Close whichever dropdown is open on any outside click.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpenMenu(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [openMenu]);

  // When a custom range is active, the preset box wears the range itself.
  const presetLabel =
    mode === "custom"
      ? rangeLabel(range(idx(from), idx(to)))
      : (PRESET_MENU.find((p) => p.key === presetKey)?.label ?? "This month");

  function pickPreset(k: string) {
    setPresetKey(k);
    setMode("preset");
    setOpenMenu(null);
    setCustomOpen(false);
    onChange(resolvePreset(k));
  }

  function pickMonth(m: string) {
    setSelectedMonth(m);
    setMode("month");
    setOpenMenu(null);
    setCustomOpen(false);
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

  const check = (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5l3.5 3.5L13 5" stroke="#e31f36" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <div ref={wrap} className="flex flex-wrap items-center gap-2">
      {/* Box 1 — preset dropdown, with custom dates tucked in at the bottom */}
      <div className="relative">
        <button
          type="button"
          className={boxClass(mode === "preset" || mode === "custom")}
          onClick={() => setOpenMenu((m) => (m === "preset" ? null : "preset"))}
        >
          <CalendarIcon />
          <span>{presetLabel}</span>
          <Chevron open={openMenu === "preset"} />
        </button>
        {openMenu === "preset" ? (
          <div className="modal-pop absolute left-0 top-full z-30 mt-1.5 min-w-[208px] rounded-xl border border-line bg-card p-1 shadow-lg">
            {PRESET_MENU.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => pickPreset(p.key)}
                className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-[13px] text-ink transition hover:bg-page"
              >
                {p.label}
                {mode === "preset" && presetKey === p.key ? check : null}
              </button>
            ))}

            <div className="mx-2 my-1 border-t border-line" />
            <button
              type="button"
              onClick={() => {
                const next = !customOpen;
                setCustomOpen(next);
                if (next) {
                  setMode("custom");
                  applyCustom(from, to);
                }
              }}
              className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-[13px] text-ink transition hover:bg-page"
            >
              Custom dates
              <span className="flex items-center gap-1.5">
                {mode === "custom" ? check : null}
                <Chevron open={customOpen} />
              </span>
            </button>
            {customOpen ? (
              <div className="fade-up space-y-1.5 px-3 pb-2 pt-1 text-[12px] text-muted">
                <label className="flex items-center justify-between gap-2">
                  From
                  <input
                    type="month"
                    min="2026-01"
                    max="2026-12"
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      setMode("custom");
                      applyCustom(e.target.value, to);
                    }}
                    className="hairline rounded-lg border border-line bg-card px-2 py-1 text-ink outline-none focus:border-ink/40"
                  />
                </label>
                <label className="flex items-center justify-between gap-2">
                  To
                  <input
                    type="month"
                    min="2026-01"
                    max="2026-12"
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                      setMode("custom");
                      applyCustom(from, e.target.value);
                    }}
                    className="hairline rounded-lg border border-line bg-card px-2 py-1 text-ink outline-none focus:border-ink/40"
                  />
                </label>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Box 2 — by month (custom dropdown, mirrors Box 1) */}
      <div className="relative">
        <button
          type="button"
          className={boxClass(mode === "month")}
          onClick={() => setOpenMenu((m) => (m === "month" ? null : "month"))}
        >
          <MonthIcon />
          <span>{mode === "month" ? monthLabel(selectedMonth) : "By month"}</span>
          <Chevron open={openMenu === "month"} />
        </button>
        {openMenu === "month" ? (
          <div className="modal-pop absolute left-0 top-full z-30 mt-1.5 max-h-64 min-w-[184px] overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-lg">
            {ALL_MONTHS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => pickMonth(m)}
                className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-[13px] text-ink transition hover:bg-page"
              >
                {monthLabel(m)}
                {mode === "month" && selectedMonth === m ? check : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
