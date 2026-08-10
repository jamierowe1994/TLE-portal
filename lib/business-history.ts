import "server-only";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";
import { hasDb, q } from "@/lib/db";
import { rexConfigured, rexLettingsAgents } from "@/lib/rex";
import { getBusinessMonthCounts } from "@/lib/rex-stats";
import { getPropolyMoveInsInRange } from "@/lib/propoly-deals";
import { HISTORY_FLOOR, withinHistory } from "@/lib/roster";

// Live funnel figures for CLOSED months, computed once with the validated
// definitions and stored forever (a finished month can't change, so we don't
// spend REX round-trips re-pulling it). The admin Overview compares these
// against Susan's report for the same month and shows a red discrepancy dot
// where they differ — the point is to SURFACE definition gaps, not hide them.
//
// Dual backend like every other store: Postgres (history_funnels) when
// DATABASE_URL is set, else history.json under DATA_DIR.

export interface HistoryFunnel {
  month: string; // "YYYY-MM"
  marketAppraisals: number | null; // recorded appraisals only
  /** Susan's "combined MAs" — recorded + listing-only (no same-month MA). */
  combinedMas?: number | null;
  listings: number | null; // created in month, rental, drafts excluded
  viewings: number | null; // TLE viewing appts, cancellations excluded
  applications: number | null; // accepted in month
  moveIns: number | null; // Propoly completed deals, move-in in month
  computedAt: string; // ISO
  /** Which DEFINITION produced these figures — see DEFINITION_VERSION. */
  definitionVersion?: number;
}

/**
 * Bump this whenever the meaning of a stored figure changes, so months frozen
 * under the old definition recompute instead of being served forever.
 *
 * A closed month's DATA can't change, which is why these are stored — but the
 * definition applied to it can, and when it does the stored row is no longer
 * an answer to the same question.
 *
 * 2 — 10 Aug 2026. The lettings-agent list widened to include TLE partners
 *     filed under @thepropertyexperts.co.uk, and appraisals narrowed to
 *     `appraisal_type = rent`. July's listings go 34 → 44 and combined MAs
 *     36 → 47. June is unchanged at 41 (it gained 3 listings and lost 3 sales
 *     appraisals, which happened to cancel) so Susan's reconciliation holds.
 */
const DEFINITION_VERSION = 2;

/* ------------------------------- storage -------------------------------- */

const FILE = path.join(DATA_DIR, "history.json");

async function readFileStore(): Promise<Record<string, HistoryFunnel>> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeFileStore(all: Record<string, HistoryFunnel>): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2));
}

async function loadStored(): Promise<Record<string, HistoryFunnel>> {
  if (hasDb()) {
    const rows = await q<{ month: string; data: string }>(
      "SELECT month, data FROM history_funnels"
    );
    const out: Record<string, HistoryFunnel> = {};
    for (const r of rows) {
      try {
        out[r.month] = JSON.parse(r.data) as HistoryFunnel;
      } catch {
        /* skip corrupt row */
      }
    }
    return out;
  }
  return readFileStore();
}

async function store(entry: HistoryFunnel): Promise<void> {
  if (hasDb()) {
    await q(
      `INSERT INTO history_funnels (month, data) VALUES ($1, $2)
       ON CONFLICT (month) DO UPDATE SET data = $2, computed_at = NOW()`,
      [entry.month, JSON.stringify(entry)]
    );
    return;
  }
  const all = await readFileStore();
  all[entry.month] = entry;
  await writeFileStore(all);
}

/* ------------------------------ computation ------------------------------ */

function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

async function computeMonth(month: string): Promise<HistoryFunnel | null> {
  if (!rexConfigured()) return null;
  const agents = await rexLettingsAgents();
  const [counts, moveIns] = await Promise.all([
    getBusinessMonthCounts(month, agents.map((a) => a.id)),
    getPropolyMoveInsInRange(`${month}-01`, lastDayOf(month)).catch(() => null),
  ]);
  if (!counts && moveIns == null) return null;
  return {
    month,
    marketAppraisals: counts?.marketAppraisals ?? null,
    combinedMas: counts?.combinedMas ?? null,
    listings: counts?.newListings ?? null,
    viewings: counts?.viewings ?? null,
    applications: counts?.applications ?? null,
    moveIns,
    computedAt: new Date().toISOString(),
    definitionVersion: DEFINITION_VERSION,
  };
}

// A month worth storing has every REX metric present (a partial pull — REX
// timeout mid-run — must not be frozen forever as the "final" figures).
function complete(h: HistoryFunnel): boolean {
  // Stale-definition rows are treated as incomplete so they recompute once.
  if ((h.definitionVersion ?? 1) < DEFINITION_VERSION) return false;
  return (
    h.marketAppraisals != null &&
    h.combinedMas != null && // added later — forces a one-off recompute of early stores
    h.listings != null &&
    h.viewings != null &&
    h.applications != null &&
    h.moveIns != null
  );
}

/**
 * The reporting floor and its clamp live in lib/roster.ts, which is
 * client-safe — the Overview needs the same fact to clamp its picker, and it
 * cannot import from a "server-only" module. Re-exported here so server
 * callers still find it where they'd expect.
 */
export { HISTORY_FLOOR, withinHistory } from "@/lib/roster";

export async function getHistory(
  fromMonth = HISTORY_FLOOR
): Promise<Record<string, HistoryFunnel>> {
  const now = new Date();
  const months: string[] = [];
  const from = withinHistory(fromMonth);
  const cursor = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 1));
  // up to (not including) the current month — current month is live, not history
  const currentKey = now.toISOString().slice(0, 7);
  while (cursor.toISOString().slice(0, 7) < currentKey) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const stored = await loadStored().catch(() => ({}) as Record<string, HistoryFunnel>);
  const out: Record<string, HistoryFunnel> = {};

  // Stored months cost nothing — take them first and only compute the gaps.
  const missing: string[] = [];
  for (const m of months) {
    if (stored[m] && complete(stored[m])) out[m] = stored[m];
    else missing.push(m);
  }

  /*
   * WARM PROPOLY FIRST, before fanning anything out.
   *
   * getPropolyMoveInsInRange races a shared 15s deadline over a cold cache of
   * every completed deal. Cold, the first caller spends ~10-15s filling that
   * cache; warm, every later month is served from it in ~0ms. Fanned out cold,
   * several months hit the deadline together and return null — and because
   * `complete()` requires a non-null moveIns, those months were never STORED,
   * so every subsequent load recomputed them and timed out again. Measured
   * 10 Aug 2026: 2025-09 null at exactly 15,003ms, 2025-10 fine at 10,492ms,
   * everything after it 0ms.
   *
   * One throwaway call pays that cost once, in series, where it can't collide.
   */
  if (missing.length > 1) {
    await getPropolyMoveInsInRange(`${months[0]}-01`, lastDayOf(months[0])).catch(() => null);
  }

  // Cold months fanned out, capped so a twelve-month backfill doesn't open
  // twelve simultaneous Rex paging walks. Measured: no throttling at this
  // width, and identical figures to the serial walk.
  const CONCURRENCY = 4;
  const queue = [...missing];
  const computedAll = new Map<string, HistoryFunnel | null>();
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const m = queue.shift();
        if (!m) return;
        computedAll.set(m, await computeMonth(m).catch(() => null));
      }
    })
  );

  // Stored serially AFTER the fan-out: the file-backed store rewrites the
  // whole JSON document each time, so concurrent writes would lose months.
  for (const m of missing) {
    const computed = computedAll.get(m) ?? null;
    if (computed) {
      out[m] = computed;
      if (complete(computed)) await store(computed).catch(() => undefined);
    } else if (stored[m]) {
      out[m] = stored[m]; // partial from a previous run beats nothing
    }
  }
  return out;
}

/* --------------------------------- YoY ----------------------------------- */

export interface YoYLive {
  moveIns: { prevYtd: number; currYtd: number; from: string; to: string } | null;
  generatedAt: string;
}

/**
 * Like-for-like year on year: 1 Jan → today vs 1 Jan → same day last year
 * (James: "measure it from this time last year, 21st of the 7th to 21st of
 * the 7th"). Move-ins from Propoly, whose history reaches back to 2023.
 */
export async function getYoYLive(): Promise<YoYLive> {
  const today = new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const sameDayLastYear = `${year - 1}${today.slice(4)}`;
  const [prevYtd, currYtd] = await Promise.all([
    getPropolyMoveInsInRange(`${year - 1}-01-01`, sameDayLastYear).catch(() => null),
    getPropolyMoveInsInRange(`${year}-01-01`, today).catch(() => null),
  ]);
  return {
    moveIns:
      prevYtd != null && currYtd != null
        ? { prevYtd, currYtd, from: `${year - 1}-01-01`, to: today }
        : null,
    generatedAt: new Date().toISOString(),
  };
}
