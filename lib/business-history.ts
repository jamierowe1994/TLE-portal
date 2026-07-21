import "server-only";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";
import { hasDb, q } from "@/lib/db";
import { rexConfigured, rexLettingsAgents } from "@/lib/rex";
import { getBusinessMonthCounts } from "@/lib/rex-stats";
import { getPropolyMoveInsInRange } from "@/lib/propoly-deals";

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
}

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
  };
}

// A month worth storing has every REX metric present (a partial pull — REX
// timeout mid-run — must not be frozen forever as the "final" figures).
function complete(h: HistoryFunnel): boolean {
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
 * Funnel history for every closed month from `fromMonth` (default 2026-01) to
 * last month. Stored months come back instantly; missing ones are computed
 * live and — when complete — stored permanently. Never throws.
 */
export async function getHistory(
  fromMonth = "2026-01"
): Promise<Record<string, HistoryFunnel>> {
  const now = new Date();
  const months: string[] = [];
  const cursor = new Date(Date.UTC(Number(fromMonth.slice(0, 4)), Number(fromMonth.slice(5, 7)) - 1, 1));
  // up to (not including) the current month — current month is live, not history
  const currentKey = now.toISOString().slice(0, 7);
  while (cursor.toISOString().slice(0, 7) < currentKey) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const stored = await loadStored().catch(() => ({}) as Record<string, HistoryFunnel>);
  const out: Record<string, HistoryFunnel> = {};

  // Serial on purpose — each month is already parallel inside, and 6-7 months
  // of concurrent calendar paging would hammer REX's rate limits.
  for (const m of months) {
    if (stored[m] && complete(stored[m])) {
      out[m] = stored[m];
      continue;
    }
    const computed = await computeMonth(m).catch(() => null);
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
