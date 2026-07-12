"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForecastChart from "@/components/charts/ForecastChart";
import { formatGBP, formatNum, monthLabel } from "@/lib/format";

export interface SavedForecast {
  gciTarget: number | null;
  portfolioTarget: number | null;
}

interface ForecastBuilderProps {
  monthKeys: string[]; // ["2026-01" … "2026-12"]
  monthLabels: string[]; // ["Jan" … "Dec"]
  actualsNetIncome: (number | null)[]; // per month (Jan–Jun known)
  currentMonthIndex: number; // e.g. 6 for July
  savedForecasts: Record<string, SavedForecast>;
  currentManaged: number; // current managed-property count
  avgFeePerProperty: number; // £/property/month (estimated)
  onSaved?: () => void;
}

type Mode = "revenue" | "portfolio";

const round100 = (v: number) => Math.round(v / 100) * 100;

export default function ForecastBuilder({
  monthKeys,
  monthLabels,
  actualsNetIncome,
  currentMonthIndex,
  savedForecasts,
  currentManaged,
  avgFeePerProperty,
  onSaved,
}: ForecastBuilderProps) {
  const [mode, setMode] = useState<Mode>("revenue");
  const [saved, setSaved] = useState<Record<string, SavedForecast>>(savedForecasts);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editableFrom = currentMonthIndex;
  const n = monthKeys.length;

  useEffect(() => setSaved(savedForecasts), [savedForecasts]);

  const canPortfolio = avgFeePerProperty > 0;

  // The value shown for a month in the active mode (saved value, or carried
  // forward from the previous month as a starting suggestion).
  const draft = useMemo(() => {
    const lastActual = (() => {
      for (let i = actualsNetIncome.length - 1; i >= 0; i--) if (actualsNetIncome[i] != null) return actualsNetIncome[i] as number;
      return null;
    })();
    const arr: (number | null)[] = new Array(n).fill(null);
    let prev = mode === "revenue" ? (lastActual ?? avgFeePerProperty * currentManaged) : currentManaged;
    for (let i = editableFrom; i < n; i++) {
      const s = saved[monthKeys[i]];
      const savedVal = mode === "revenue" ? s?.gciTarget : s?.portfolioTarget;
      const val = savedVal != null ? savedVal : Math.round(prev);
      arr[i] = val;
      prev = val;
    }
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, saved, n, editableFrom, currentManaged, avgFeePerProperty]);

  const [live, setLive] = useState<(number | null)[]>(draft);
  useEffect(() => setLive(draft), [draft]);

  // Chart series for the active mode.
  const actualsSeries = useMemo(() => {
    if (mode === "revenue") return actualsNetIncome;
    // Portfolio: anchor the line at the current managed count (last known month).
    const a: (number | null)[] = new Array(n).fill(null);
    if (editableFrom - 1 >= 0) a[editableFrom - 1] = currentManaged;
    return a;
  }, [mode, actualsNetIncome, n, editableFrom, currentManaged]);

  const fmt = mode === "revenue"
    ? (v: number) => (v >= 1000 ? `£${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `£${Math.round(v)}`)
    : (v: number) => `${Math.round(v)}`;

  const flashSaved = useCallback(() => {
    setFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 1400);
  }, []);

  async function commit(i: number, rawValue: number) {
    const monthKey = monthKeys[i];
    let gciTarget: number;
    let portfolioTarget: number;
    if (mode === "revenue") {
      gciTarget = round100(rawValue);
      portfolioTarget = avgFeePerProperty > 0 ? Math.round(gciTarget / avgFeePerProperty) : 0;
    } else {
      portfolioTarget = Math.max(0, Math.round(rawValue));
      gciTarget = Math.round(portfolioTarget * avgFeePerProperty);
    }
    setSaved((s) => ({ ...s, [monthKey]: { gciTarget, portfolioTarget } }));
    try {
      const res = await fetch("/api/my/forecast", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: monthKey, gciTarget, portfolioTarget }),
      });
      if (res.ok) {
        flashSaved();
        onSaved?.();
      }
    } catch {
      /* keep the optimistic value */
    }
  }

  // Readouts over the editable months.
  const editable = live.slice(editableFrom).filter((v): v is number => v != null);
  const totalGci = mode === "revenue"
    ? editable.reduce((t, v) => t + round100(v), 0)
    : editable.reduce((t, v) => t + Math.round(v) * avgFeePerProperty, 0);
  const endPortfolio = mode === "portfolio" && live[n - 1] != null ? Math.round(live[n - 1] as number) : null;
  const rangeLabel = `${monthLabels[editableFrom]}–${monthLabels[n - 1]}`;

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
          Build your forecast — {rangeLabel} {monthKeys[0].slice(0, 4)}
        </h2>
        {flash ? (
          <span className="fade-up rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
            Saved ✓
          </span>
        ) : null}
        {/* revenue / portfolio toggle */}
        <div className="ml-auto flex overflow-hidden rounded-lg border border-line">
          <button
            type="button"
            onClick={() => setMode("revenue")}
            className={`px-3 py-1.5 text-[12px] font-medium ${mode === "revenue" ? "bg-accent text-white" : "bg-card text-muted hover:text-ink"}`}
          >
            By revenue
          </button>
          <button
            type="button"
            onClick={() => canPortfolio && setMode("portfolio")}
            disabled={!canPortfolio}
            title={canPortfolio ? "" : "Needs your portfolio + fee data"}
            className={`px-3 py-1.5 text-[12px] font-medium ${mode === "portfolio" ? "bg-accent text-white" : "bg-card text-muted hover:text-ink disabled:opacity-40"}`}
          >
            By portfolio size
          </button>
        </div>
      </div>

      <p className="mt-1 text-[13px] text-muted">
        {mode === "revenue"
          ? "Solid line is what you've earned. Drag each future month's dot to set your earnings forecast — it saves as you go."
          : `Forecast your portfolio growth: drag each month to the number of managed properties you expect. We estimate the £ at ${formatGBP(avgFeePerProperty)}/property/month.`}
      </p>

      <div className="mt-3">
        <ForecastChart
          labels={monthLabels}
          actuals={actualsSeries}
          forecast={live}
          editableFrom={editableFrom}
          onChange={(i, v) => setLive((cur) => cur.map((x, idx) => (idx === i ? v : x)))}
          onCommit={(i, v) => void commit(i, v)}
          format={fmt}
        />
      </div>

      {/* readouts */}
      <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {mode === "revenue" ? "Forecast total" : "Est. fees total"} · {rangeLabel}
          </div>
          <div className="stat-value mt-1.5 text-[22px]">{formatGBP(totalGci)}</div>
          <div className="mt-0.5 text-xs text-muted">Sum of your forecast months</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {mode === "revenue" ? "Avg / month" : "Portfolio by year-end"}
          </div>
          <div className="stat-value mt-1.5 text-[22px]">
            {mode === "revenue"
              ? editable.length
                ? formatGBP(Math.round(totalGci / editable.length))
                : "—"
              : endPortfolio != null
                ? formatNum(endPortfolio)
                : "—"}
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {mode === "revenue" ? `Across ${editable.length} months` : `From ${formatNum(currentManaged)} now`}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">This month</div>
          <div className="stat-value mt-1.5 text-[22px]">
            {live[currentMonthIndex] != null ? fmt(live[currentMonthIndex] as number) : "—"}
          </div>
          <div className="mt-0.5 text-xs text-muted">{monthLabel(monthKeys[currentMonthIndex])}</div>
        </div>
      </div>
    </div>
  );
}
