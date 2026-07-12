"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentForecast, StatValue, UserProfile } from "@/lib/types";
import { currentMonth, formatGBP, formatNum, monthLabel } from "@/lib/format";
import { getUser, refreshUser } from "@/lib/session";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import ForecastBuilder, { type SavedForecast } from "@/components/ForecastBuilder";

// My Forecast — the interactive year builder (drag each future month to set your
// earnings or portfolio-growth forecast), detailed this/next-month target cards
// (GCI £, move-ins, MAs, notes), and a history table of forecast vs actual.
// Actuals come from the partner net income seed (Jan–Jun 2026) where known.

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

const YEAR = "2026";
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_KEYS = MONTH_LABELS.map((_, i) => `${YEAR}-${String(i + 1).padStart(2, "0")}`);
const monthIdx = (m: string) => Number(m.slice(5, 7)) - 1;

// Standard management fee assumption for the estimated-income figure. TLE bills
// ~9% of rent (inc RLP); the agent's final share is confirmed with head office.
const MGMT_FEE_RATE = 0.09;

function addMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const d = new Date(Number(m[1]), Number(m[2]), 1); // next month (0-based +1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Seed actuals (partner net income £ by month) come from GET /api/my/forecast —
// computed server-side, since the seed data itself is server-only.

/* ------------------------------------------------------------------------ */
/* Month target editor                                                       */
/* ------------------------------------------------------------------------ */

type SaveState = "idle" | "saving" | "saved" | "error";

function MonthEditor({
  month,
  tag,
  forecast,
  onSaved,
}: {
  month: string;
  tag: string;
  forecast: AgentForecast | null;
  onSaved: (f: AgentForecast) => void;
}) {
  const [gci, setGci] = useState("");
  const [moveIns, setMoveIns] = useState("");
  const [mas, setMas] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState("");

  // Populate fields when the stored forecast arrives (or changes).
  useEffect(() => {
    setGci(forecast?.gciTarget != null ? String(forecast.gciTarget) : "");
    setMoveIns(
      forecast?.moveInsTarget != null ? String(forecast.moveInsTarget) : ""
    );
    setMas(forecast?.maTarget != null ? String(forecast.maTarget) : "");
    setNotes(forecast?.notes ?? "");
  }, [forecast]);

  const markDirty = () => {
    if (state === "saved" || state === "error") setState("idle");
  };

  async function save() {
    setState("saving");
    setError("");
    try {
      const res = await fetch("/api/my/forecast", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          gciTarget: gci.trim() === "" ? null : Number(gci),
          moveInsTarget: moveIns.trim() === "" ? null : Number(moveIns),
          maTarget: mas.trim() === "" ? null : Number(mas),
          notes: notes.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        forecast?: AgentForecast;
        error?: string;
      };
      if (!res.ok || !data.forecast) {
        throw new Error(data.error ?? "Could not save your forecast.");
      }
      onSaved(data.forecast);
      setState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setState("error");
    }
  }

  const field =
    "mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm tnum " +
    "outline-none focus:border-accent";

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">{monthLabel(month)}</h2>
        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
          {tag}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            GCI target (£ exc VAT)
          </span>
          <input
            type="number"
            min={0}
            inputMode="decimal"
            placeholder="e.g. 2500"
            className={field}
            value={gci}
            onChange={(e) => {
              setGci(e.target.value);
              markDirty();
            }}
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Move-ins target
          </span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="e.g. 3"
            className={field}
            value={moveIns}
            onChange={(e) => {
              setMoveIns(e.target.value);
              markDirty();
            }}
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            MAs target
          </span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="e.g. 5"
            className={field}
            value={mas}
            onChange={(e) => {
              setMas(e.target.value);
              markDirty();
            }}
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Notes (optional)
        </span>
        <textarea
          rows={2}
          placeholder="Anything Susan should know about this month — big instructions landing, holiday booked…"
          className={`${field} resize-y`}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            markDirty();
          }}
        />
      </label>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={state === "saving"}
          className="btn-press rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {state === "saving" ? "Saving…" : "Save forecast"}
        </button>
        {state === "saved" ? (
          <span className="text-sm font-medium text-emerald-600">Saved.</span>
        ) : null}
        {state === "error" ? (
          <span className="text-sm font-medium text-accent">{error}</span>
        ) : null}
        {forecast?.updatedAt && state === "idle" ? (
          <span className="text-xs text-muted">
            Last saved {new Date(forecast.updatedAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Page                                                                      */
/* ------------------------------------------------------------------------ */

interface HistoryRow extends Record<string, unknown> {
  month: string;
  gciTarget: number | null;
  moveInsTarget: number | null;
  maTarget: number | null;
  actual: number | null;
  hit: boolean | null;
}

export default function ForecastPage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [history, setHistory] = useState<AgentForecast[]>([]);
  const [actuals, setActuals] = useState<Record<string, number | null>>({});
  const [portfolio, setPortfolio] = useState<{ managed: number; rentRoll: number }>({ managed: 0, rentRoll: 0 });
  const [loading, setLoading] = useState(true);

  const thisMonth = currentMonth();
  const nextMonth = addMonth(thisMonth);

  const load = useCallback(async () => {
    try {
      const [fRes, sRes] = await Promise.all([
        fetch("/api/my/forecast", { cache: "no-store" }),
        fetch(`/api/my/stats?month=${thisMonth}`, { cache: "no-store" }).catch(() => null),
      ]);
      if (fRes.ok) {
        const data = (await fRes.json()) as {
          history: AgentForecast[];
          actuals?: Record<string, number | null>;
        };
        setHistory(data.history ?? []);
        setActuals(data.actuals ?? {});
      }
      if (sRes && sRes.ok) {
        const s = (await sRes.json()) as {
          portfolio?: { managed: StatValue; rentRoll: StatValue };
        };
        setPortfolio({
          managed: s.portfolio?.managed.value ?? 0,
          rentRoll: s.portfolio?.rentRoll.value ?? 0,
        });
      }
    } catch {
      // network hiccup — keep whatever we had
    } finally {
      setLoading(false);
    }
  }, [thisMonth]);

  useEffect(() => {
    setUser(getUser());
    refreshUser().then((u) => {
      if (u) setUser(u);
    });
    load();
  }, [load]);

  // Merge a just-saved forecast into local history (no refetch needed).
  const onSaved = useCallback((f: AgentForecast) => {
    setHistory((prev) => {
      const rest = prev.filter((h) => h.month !== f.month);
      return [...rest, f].sort((a, b) => b.month.localeCompare(a.month));
    });
  }, []);

  const forecastFor = (month: string) =>
    history.find((h) => h.month === month) ?? null;

  const agentKey = user?.agentKey ?? null;

  /* ------------------------ interactive builder inputs ---------------------- */

  const currentMonthIndex = monthIdx(thisMonth);
  const actualsNetIncome = useMemo(
    () => MONTH_KEYS.map((k) => actuals[k] ?? null),
    [actuals]
  );
  const savedForecasts = useMemo(() => {
    const map: Record<string, SavedForecast> = {};
    for (const h of history) {
      map[h.month] = { gciTarget: h.gciTarget ?? null, portfolioTarget: h.portfolioTarget ?? null };
    }
    return map;
  }, [history]);
  const avgFeePerProperty =
    portfolio.managed > 0 ? (portfolio.rentRoll * MGMT_FEE_RATE) / portfolio.managed : 0;

  // Past + current months only in history (next month lives in its editor).
  const historyRows: HistoryRow[] = history
    .filter((h) => h.month <= thisMonth)
    .map((h) => {
      const actual = actuals[h.month] ?? null;
      const hit =
        h.gciTarget != null && actual != null ? actual >= h.gciTarget : null;
      return {
        month: h.month,
        gciTarget: h.gciTarget,
        moveInsTarget: h.moveInsTarget,
        maTarget: h.maTarget,
        actual,
        hit,
      };
    });

  const columns: DataTableColumn<HistoryRow>[] = [
    { key: "month", label: "Month", render: (r) => monthLabel(r.month) },
    {
      key: "gciTarget",
      label: "GCI target",
      align: "right",
      render: (r) => formatGBP(r.gciTarget),
    },
    {
      key: "moveInsTarget",
      label: "Move-ins",
      align: "right",
      render: (r) => formatNum(r.moveInsTarget),
    },
    {
      key: "maTarget",
      label: "MAs",
      align: "right",
      render: (r) => formatNum(r.maTarget),
    },
    {
      key: "actual",
      label: "Actual (net income)",
      align: "right",
      render: (r) =>
        r.actual != null ? (
          formatGBP(r.actual)
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "hit",
      label: "Hit?",
      render: (r) =>
        r.hit == null ? (
          <span className="text-muted">—</span>
        ) : r.hit ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            Hit
          </span>
        ) : (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
            Missed
          </span>
        ),
    },
  ];

  return (
    <div className="fade-up space-y-6">
      <div>
        <h1 className="text-xl font-semibold">My Forecast</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Set your targets for this month and next. Your forecast feeds the
          business forecast — Susan sees every partner&rsquo;s targets rolled up
          into one number, and the portal tracks your actuals against what you
          said. Keep it honest and keep it current.
        </p>
      </div>

      {/* Interactive year builder — drag each future month to build the forecast */}
      {loading ? (
        <div className="card p-6 text-sm text-muted">Loading your forecast…</div>
      ) : (
        <ForecastBuilder
          monthKeys={MONTH_KEYS}
          monthLabels={MONTH_LABELS}
          actualsNetIncome={actualsNetIncome}
          currentMonthIndex={currentMonthIndex}
          savedForecasts={savedForecasts}
          currentManaged={portfolio.managed}
          avgFeePerProperty={avgFeePerProperty}
          onSaved={load}
        />
      )}

      <div>
        <h2 className="mb-2 text-base font-semibold">Detailed targets</h2>
        <p className="mb-3 max-w-2xl text-[13px] text-muted">
          Add the extra detail head office tracks for this month and next —
          move-ins, MAs, and any notes. The GCI here stays in step with the
          builder above.
        </p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <MonthEditor
            month={thisMonth}
            tag="This month"
            forecast={forecastFor(thisMonth)}
            onSaved={onSaved}
          />
          <MonthEditor
            month={nextMonth}
            tag="Next month"
            forecast={forecastFor(nextMonth)}
            onSaved={onSaved}
          />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Forecast history</h2>
          <span className="text-xs text-muted">
            Actuals from the monthly partner fee report (Jan–Jun 2026) where known
          </span>
        </div>
        {loading ? (
          <div className="card p-6 text-sm text-muted">Loading your forecasts…</div>
        ) : (
          <DataTable columns={columns} rows={historyRows} compact />
        )}
        {!loading && !agentKey ? (
          <p className="mt-2 text-xs text-muted">
            Your account isn&rsquo;t linked to a partner record yet, so actuals
            can&rsquo;t be matched — ask head office to link your profile.
          </p>
        ) : null}
      </div>
    </div>
  );
}
