"use client";

import { useState } from "react";
import { formatGBP, monthLabel } from "@/lib/format";

/**
 * Susan's own forecast, set by month.
 *
 * Stored as a manual override at `forecast.susan.<month>` — the same store the
 * P&L upload writes to. "A person typed this" is one kind of fact and deserves
 * one store, not a new table each time somebody needs to type a number.
 *
 * Takes a paste as well as a single figure, because a forecast is usually set
 * for a run of months in one sitting and typing them one at a time is how it
 * ends up half done.
 */
export default function SusanForecast({
  month,
  current,
  onSaved,
}: {
  month: string;
  current: number | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [one, setOne] = useState(current == null ? "" : String(current));
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function put(m: string, value: number) {
    const res = await fetch("/api/admin/actuals", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "business",
        month: m,
        metric: `forecast.susan.${m}`,
        value,
        note: `Susan's forecast for ${monthLabel(m)}`,
      }),
    });
    if (!res.ok) throw new Error(m);
  }

  async function saveOne() {
    const v = Number(one.replace(/[£,\s]/g, ""));
    if (!Number.isFinite(v)) {
      setMsg("That isn't a number.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await put(month, v);
      setMsg(`Saved for ${monthLabel(month)}.`);
      onSaved();
    } catch {
      setMsg("Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveBulk() {
    // "2026-08  45000" per line, or a tab from a spreadsheet.
    const rows = bulk
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = /^(\d{4}-\d{2})\D+([\d.,£\s]+)$/.exec(l);
        if (!m) return null;
        const v = Number(m[2].replace(/[£,\s]/g, ""));
        return Number.isFinite(v) ? ([m[1], v] as [string, number]) : null;
      });
    const good = rows.filter(Boolean) as Array<[string, number]>;
    if (!good.length) {
      setMsg("Expected lines like  2026-08  45000");
      return;
    }
    setBusy(true);
    setMsg(null);
    const failed: string[] = [];
    for (const [m, v] of good) {
      try {
        await put(m, v);
      } catch {
        failed.push(m);
      }
    }
    setBusy(false);
    setMsg(
      failed.length
        ? `${good.length - failed.length} saved, ${failed.length} failed: ${failed.join(", ")}`
        : `${good.length} months saved.`
    );
    onSaved();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium transition-colors hover:border-ink/40"
      >
        {current == null ? "Set Susan's forecast" : "Edit Susan's forecast"}
      </button>
    );
  }

  return (
    <div className="card mt-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Susan&rsquo;s forecast</h3>
          <p className="mt-0.5 text-xs text-muted">
            The business figure, set against the partners&rsquo; own roll-up so the two
            can be compared month by month.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted transition-colors hover:text-ink"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="block text-muted">{monthLabel(month)}</span>
          <input
            value={one}
            onChange={(e) => setOne(e.target.value)}
            placeholder="45000"
            className="mt-1 w-40 rounded-lg border border-line bg-card px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={saveOne}
          disabled={busy}
          className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          Save
        </button>
      </div>

      <div className="mt-4 border-t border-line/70 pt-3">
        <p className="text-xs text-muted">Or paste several months at once</p>
        <textarea
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          rows={4}
          placeholder={"2026-08\t45000\n2026-09\t47000\n2026-10\t48000"}
          className="mt-2 w-full rounded-lg border border-line bg-card p-3 font-mono text-xs"
        />
        <button
          type="button"
          onClick={saveBulk}
          disabled={busy || !bulk.trim()}
          className="mt-2 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save these months"}
        </button>
      </div>

      {msg ? <p className="mt-3 text-xs text-muted">{msg}</p> : null}
      {current != null ? (
        <p className="mt-2 text-xs text-muted">
          Currently {formatGBP(current)} for {monthLabel(month)}.
        </p>
      ) : null}
    </div>
  );
}
