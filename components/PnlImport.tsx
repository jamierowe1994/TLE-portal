"use client";

import { useState } from "react";
import { parsePnlImport, type ParsedPnl } from "@/lib/pnl-import";
import type { H2ReforecastRow } from "@/lib/seed-types";
import { formatGBP } from "@/lib/format";

/**
 * Paste a P&L in, rather than typing forty cells.
 *
 * Writes to exactly the same place a typed cell does — a manual override at
 * `pnl.<lineKey>.<month>` — so an upload and a hand correction are the same
 * kind of fact and neither silently wins. Nothing is written until the preview
 * has been seen and Apply pressed.
 *
 * The preview is not decoration. A P&L export usually carries budget, actual
 * and variance side by side, and reading the wrong one produces a page full of
 * plausible, entirely wrong figures. So the column that was read is named, the
 * alternatives are offered, and every unmatched line is shown rather than
 * dropped.
 */
export default function PnlImport({
  month,
  lines,
  onApplied,
}: {
  month: string;
  lines: H2ReforecastRow[];
  onApplied: (applied: Record<string, number>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedPnl | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  function read(forceColumn?: number) {
    setDone(null);
    const r = parsePnlImport(text, month, lines, forceColumn);
    if ("error" in r) {
      setError(r.error);
      setParsed(null);
      return;
    }
    setError(null);
    setParsed(r);
  }

  async function apply() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    const applied: Record<string, number> = {};
    const failed: string[] = [];
    for (const m of parsed.matched) {
      try {
        const res = await fetch("/api/admin/actuals", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: "business",
            month,
            metric: `pnl.${m.key}.${month}`,
            value: m.value,
            note: `P&L upload — ${m.label}, read from "${parsed.valueColumn}"`,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        applied[m.key] = m.value;
      } catch {
        failed.push(m.label);
      }
    }
    setBusy(false);
    onApplied(applied);
    // Partial success is reported as partial. Saying "done" over three failures
    // is how a figure goes missing without anybody noticing.
    setDone(
      failed.length
        ? `${Object.keys(applied).length} lines saved, ${failed.length} failed: ${failed.join(", ")}`
        : `${Object.keys(applied).length} lines saved.`
    );
    if (!failed.length) setParsed(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium transition-colors hover:border-ink/40"
      >
        Upload P&amp;L
      </button>
    );
  }

  return (
    <div className="card mt-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Upload the P&amp;L</h3>
          <p className="mt-0.5 text-xs text-muted">
            Paste it straight from the spreadsheet. Line names in the first column,
            figures alongside. Nothing is saved until you have seen the preview.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setParsed(null);
            setError(null);
            setDone(null);
          }}
          className="text-muted transition-colors hover:text-ink"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={"Line\tBudget\tActual\nManagement Fees (inc RLP)\t29,000\t28,886\nLicence Fees\t3,500\t3,450"}
        className="mt-3 w-full rounded-lg border border-line bg-card p-3 font-mono text-xs"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => read()}
          disabled={!text.trim()}
          className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          Read it
        </button>
        {parsed ? (
          <button
            type="button"
            onClick={apply}
            disabled={busy}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
          >
            {busy ? "Saving…" : `Apply ${parsed.matched.length} lines`}
          </button>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
      {done ? <p className="mt-3 text-xs text-muted">{done}</p> : null}

      {parsed ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted">Read from</span>
            <span className="font-semibold">{parsed.valueColumn}</span>
            {parsed.columnChoices.length > 1 ? (
              <>
                <span className="text-muted">— wrong one?</span>
                {parsed.columnChoices
                  .filter((c) => c.header !== parsed.valueColumn)
                  .map((c) => (
                    <button
                      key={c.index}
                      type="button"
                      onClick={() => read(c.index)}
                      className="rounded border border-line px-2 py-0.5 transition-colors hover:border-ink/40"
                    >
                      use {c.header}
                    </button>
                  ))}
              </>
            ) : null}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody>
                {parsed.matched.map((m) => (
                  <tr key={m.key} className="border-b border-line/60">
                    <td className="py-1.5">{m.label}</td>
                    <td className="py-1.5 text-right tnum font-semibold">
                      {formatGBP(m.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {parsed.unmatched.length ? (
            <p className="text-xs text-muted">
              <span className="font-semibold">Not applied</span> — no P&amp;L line of
              that name: {parsed.unmatched.map((u) => u.label).join(", ")}
            </p>
          ) : null}
          {parsed.skipped.length ? (
            <p className="text-xs text-muted">
              <span className="font-semibold">No figure on</span>{" "}
              {parsed.skipped.slice(0, 6).join(", ")}
              {parsed.skipped.length > 6 ? ` +${parsed.skipped.length - 6} more` : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
