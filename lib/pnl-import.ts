import type { H2ReforecastRow } from "@/lib/seed-types";

/**
 * Reading a P&L that somebody pasted in.
 *
 * The P&L grid is already click-to-edit — each cell writes a manual override to
 * /api/admin/actuals under `pnl.<lineKey>.<month>`. That works and is the right
 * store, but it is one cell at a time, and a P&L has forty lines. This reads
 * the whole thing in one go and writes to exactly the same place, so an upload
 * and a typed correction are the same kind of fact and neither wins by accident.
 *
 * Shaped after parseArrearsImport, deliberately:
 *   • nothing is silently dropped — unmatched lines come back to be shown
 *   • which column a figure came from is reported, so a mis-map is visible
 *   • the caller previews before anything is written
 *
 * It matches on the LABEL, because that is what a P&L export carries; the line
 * keys are ours and appear in no accounting system.
 */

export interface PnlMatch {
  key: string;
  label: string;
  /** The label as it appeared in the file, when it differs from ours. */
  matchedOn: string;
  value: number;
}

export interface ParsedPnl {
  month: string;
  matched: PnlMatch[];
  /** Lines that looked like data but matched no P&L line we hold. */
  unmatched: Array<{ label: string; value: number }>;
  /** Lines that carried no readable figure at all. */
  skipped: string[];
  /** Which column the money was read from, so a wrong one is obvious. */
  valueColumn: string;
  /** Every column that held figures, so the UI can offer a different one.
   *  A P&L with budget / actual / variance gives three, and only one is right. */
  columnChoices: Array<{ index: number; header: string }>;
}

/** Tab first — that is what a spreadsheet paste gives — then CSV with quotes. */
function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Accounting exports write a negative as (1,234). Brackets are the sign, so
 * they have to be read as one — a naive strip turns a cost into income.
 */
function toMoney(raw: string): number | null {
  const s = raw.replace(/[£$,\s]/g, "").trim();
  if (!s) return null;
  const bracketed = /^\((.*)\)$/.exec(s);
  const n = Number(bracketed ? bracketed[1] : s);
  if (!Number.isFinite(n)) return null;
  return bracketed ? -n : n;
}

/** Loose enough to survive "Licence Income" vs "licence fee income". */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(total|monthly|per month|pcm|net|gross|inc vat|exc vat)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function parsePnlImport(
  text: string,
  month: string,
  lines: H2ReforecastRow[],
  /** Force a column, once the preview has shown which ones exist. */
  forceColumn?: number
): ParsedPnl | { error: string } {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (rows.length < 2) {
    return { error: "Needs at least a couple of rows — a label and a figure per line." };
  }

  const index = new Map<string, H2ReforecastRow>();
  for (const l of lines) index.set(norm(l.label), l);

  // WHICH COLUMN HOLDS THE MONEY.
  //
  // A P&L export routinely carries budget, actual and variance side by side.
  // The first version of this took the right-most numeric column, which is the
  // VARIANCE — so it imported -114 where the actual was 28,886, matched every
  // line, and looked entirely correct. Caught in test, not in production, and
  // it is the reason this reports its choice back rather than deciding quietly.
  //
  // Header first, because that is the only thing that actually knows. Only if
  // there is no usable header does it fall back to magnitude, on the reasoning
  // that an actual dwarfs its own variance.
  const cells = rows.map(splitLine);
  const width = Math.max(...cells.map((c) => c.length));
  const header = cells[0].map((h) => h.toLowerCase().trim());
  const WANT = /\bactual|\bytd\b|^jul|^aug|^sep|^oct|^nov|^dec|^jan|^feb|^mar|^apr|^may|^jun|\d{4}-\d{2}/;
  const AVOID = /budget|forecast|variance|\bvar\b|plan|diff|last year|prior|%/;

  const numeric = (c: number) => cells.slice(1).filter((r) => toMoney(r[c] ?? "") != null).length;
  const magnitude = (c: number) =>
    cells.slice(1).reduce((t, r) => t + Math.abs(toMoney(r[c] ?? "") ?? 0), 0);

  const candidates: number[] = [];
  for (let c = 1; c < width; c++) if (numeric(c) >= 2) candidates.push(c);
  if (candidates.length === 0) {
    return { error: "Couldn't find a column of figures. Expected a label and an amount per row." };
  }

  let valueCol = forceColumn != null && candidates.includes(forceColumn) ? forceColumn : -1;
  if (valueCol < 0) valueCol = candidates.find((c) => WANT.test(header[c] ?? "") && !AVOID.test(header[c] ?? "")) ?? -1;
  if (valueCol < 0) {
    const allowed = candidates.filter((c) => !AVOID.test(header[c] ?? ""));
    const pool = allowed.length ? allowed : candidates;
    valueCol = pool.reduce((bestC, c) => (magnitude(c) > magnitude(bestC) ? c : bestC), pool[0]);
  }

  const matched: PnlMatch[] = [];
  const unmatched: Array<{ label: string; value: number }> = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const r of cells) {
    const label = (r[0] ?? "").trim();
    const value = toMoney(r[valueCol] ?? "");
    if (!label) continue;
    if (value == null) {
      skipped.push(label);
      continue;
    }
    const hit = index.get(norm(label));
    if (!hit) {
      unmatched.push({ label, value });
      continue;
    }
    // First occurrence wins. A P&L repeats a label in subtotals, and the
    // subtotal is not the line.
    if (seen.has(hit.key)) continue;
    seen.add(hit.key);
    matched.push({ key: hit.key, label: hit.label, matchedOn: label, value });
  }

  if (matched.length === 0) {
    return {
      error:
        "No line matched the P&L grid. Check the first column holds the line names — " +
        `read ${rows.length} rows and matched none of ${lines.length} known lines.`,
    };
  }
  // Only call the first row a header if it is NOT itself a figure — otherwise
  // a file with no header names its column after the first row's money.
  const nameOf = (c: number) => {
    const first = (cells[0][c] ?? "").trim();
    return first && toMoney(first) == null ? first : `column ${c + 1}`;
  };
  return {
    month,
    matched,
    unmatched,
    skipped,
    valueColumn: nameOf(valueCol),
    columnChoices: candidates.map((c) => ({ index: c, header: nameOf(c) })),
  };
}
