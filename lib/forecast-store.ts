import "server-only";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";
import { hasDb, q } from "@/lib/db";
import type { AgentForecast } from "@/lib/types";

// Forecast store — agent-set monthly targets, keyed (userId, month).
// Dual backend like TEG: Postgres (`forecasts` table, schema in lib/db.ts)
// when DATABASE_URL is set, otherwise `forecasts.json` under DATA_DIR.

/* ------------------------------------------------------------------------ */
/* Postgres row mapping                                                      */
/* ------------------------------------------------------------------------ */

interface ForecastRow extends Record<string, unknown> {
  user_id: string;
  month: string;
  gci_target: string | number | null;   // NUMERIC comes back as string from pg
  portfolio_target: string | number | null;
  move_ins_target: string | number | null;
  ma_target: string | number | null;
  notes: string | null;
  updated_at: string | Date;
}

function toNum(v: string | number | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function rowToForecast(row: ForecastRow): AgentForecast {
  return {
    userId: row.user_id,
    month: row.month,
    gciTarget: toNum(row.gci_target),
    portfolioTarget: toNum(row.portfolio_target),
    moveInsTarget: toNum(row.move_ins_target),
    maTarget: toNum(row.ma_target),
    notes: row.notes ?? undefined,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/* ------------------------------------------------------------------------ */
/* JSON fallback                                                             */
/* ------------------------------------------------------------------------ */

const FILE = path.join(DATA_DIR, "forecasts.json");

async function readAllFile(): Promise<AgentForecast[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AgentForecast[]) : [];
  } catch {
    return [];
  }
}

async function writeAllFile(rows: AgentForecast[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(rows, null, 2), "utf8");
}

/* ------------------------------------------------------------------------ */
/* Store API                                                                 */
/* ------------------------------------------------------------------------ */

/** One user's forecast for one month ("2026-07"), or null if never set. */
export async function getForecast(
  userId: string,
  month: string
): Promise<AgentForecast | null> {
  if (hasDb()) {
    const rows = await q<ForecastRow>(
      "SELECT * FROM forecasts WHERE user_id = $1 AND month = $2",
      [userId, month]
    );
    return rows[0] ? rowToForecast(rows[0]) : null;
  }
  const all = await readAllFile();
  return all.find((f) => f.userId === userId && f.month === month) ?? null;
}

/** Insert-or-replace on (userId, month). */
export async function setForecast(forecast: AgentForecast): Promise<void> {
  if (hasDb()) {
    await q(
      `INSERT INTO forecasts
         (user_id, month, gci_target, portfolio_target, move_ins_target, ma_target, notes, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id, month) DO UPDATE SET
         gci_target       = EXCLUDED.gci_target,
         portfolio_target = EXCLUDED.portfolio_target,
         move_ins_target  = EXCLUDED.move_ins_target,
         ma_target        = EXCLUDED.ma_target,
         notes            = EXCLUDED.notes,
         updated_at       = EXCLUDED.updated_at`,
      [
        forecast.userId,
        forecast.month,
        forecast.gciTarget,
        forecast.portfolioTarget,
        forecast.moveInsTarget,
        forecast.maTarget,
        forecast.notes ?? null,
        forecast.updatedAt,
      ]
    );
    return;
  }
  const all = await readAllFile();
  const idx = all.findIndex(
    (f) => f.userId === forecast.userId && f.month === forecast.month
  );
  if (idx === -1) all.push(forecast);
  else all[idx] = forecast;
  await writeAllFile(all);
}

/** Every agent's forecast for one month — the admin roll-up input. */
export async function listForecasts(month: string): Promise<AgentForecast[]> {
  if (hasDb()) {
    const rows = await q<ForecastRow>(
      "SELECT * FROM forecasts WHERE month = $1",
      [month]
    );
    return rows.map(rowToForecast);
  }
  const all = await readAllFile();
  return all.filter((f) => f.month === month);
}

/** All months one user has ever forecast, newest month first. */
export async function listUserForecasts(
  userId: string
): Promise<AgentForecast[]> {
  if (hasDb()) {
    const rows = await q<ForecastRow>(
      "SELECT * FROM forecasts WHERE user_id = $1 ORDER BY month DESC",
      [userId]
    );
    return rows.map(rowToForecast);
  }
  const all = await readAllFile();
  return all
    .filter((f) => f.userId === userId)
    .sort((a, b) => b.month.localeCompare(a.month));
}
