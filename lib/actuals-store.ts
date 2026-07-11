import "server-only";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";
import { hasDb, q } from "@/lib/db";
import type { ActualOverride } from "@/lib/types";

// Actuals store — admin manual overrides of business/agent figures.
// Sits between live integrations and the snapshot in the resolveStat chain
// (live → MANUAL → snapshot). Dual backend: Postgres (`actual_overrides`
// table, schema in lib/db.ts) or `actual-overrides.json` under DATA_DIR.
//
// Row id is deterministic — `scope:agentKey:month:metric` (agentKey empty for
// business scope) — so writing the same figure twice upserts, never duplicates.
//
// METRIC DOT-KEYS (shared vocabulary with the admin UI):
//   funnel.marketAppraisals | funnel.listings | funnel.viewings |
//   funnel.applications | funnel.moveIns | funnel.pipeline |
//   funnel.liveListings | funnel.gci
//     — funnel counts (business scope, or agent scope with agentKey)
//   income.combinedGci | income.eAndWGci | income.glasgowGci |
//   income.tleNetIncome | income.partnerNetIncome | income.totalIncome
//     — £ income figures (business scope; month = the month the figure is FOR)
//   pnl.<line>.<month>  e.g. "pnl.totalIncome.2026-09"
//     — one cell of the admin P&L grid (H2 reforecast lines). The row's own
//       `month` field is the month the admin edited the grid in; the metric
//       key pins the P&L line + the calendar month of the cell itself.

/* ------------------------------------------------------------------------ */
/* Id + row mapping                                                          */
/* ------------------------------------------------------------------------ */

/** Deterministic id — `scope:agentKey:month:metric` (empty agentKey for business). */
export function overrideId(
  scope: "business" | "agent",
  agentKey: string | undefined,
  month: string,
  metric: string
): string {
  return `${scope}:${agentKey ?? ""}:${month}:${metric}`;
}

interface OverrideRow extends Record<string, unknown> {
  id: string;
  scope: string;
  agent_key: string | null;
  month: string;
  metric: string;
  value: string | number;   // NUMERIC comes back as string from pg
  note: string | null;
  updated_at: string | Date;
}

function rowToOverride(row: OverrideRow): ActualOverride {
  return {
    id: row.id,
    scope: row.scope === "agent" ? "agent" : "business",
    agentKey: row.agent_key ?? undefined,
    month: row.month,
    metric: row.metric,
    value: Number(row.value),
    note: row.note ?? undefined,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/* ------------------------------------------------------------------------ */
/* JSON fallback                                                             */
/* ------------------------------------------------------------------------ */

const FILE = path.join(DATA_DIR, "actual-overrides.json");

async function readAllFile(): Promise<ActualOverride[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ActualOverride[]) : [];
  } catch {
    return [];
  }
}

async function writeAllFile(rows: ActualOverride[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(rows, null, 2), "utf8");
}

/* ------------------------------------------------------------------------ */
/* Store API                                                                 */
/* ------------------------------------------------------------------------ */

/** Every override row for one month ("2026-07") — business AND agent scope. */
export async function getOverrides(month: string): Promise<ActualOverride[]> {
  if (hasDb()) {
    const rows = await q<OverrideRow>(
      "SELECT * FROM actual_overrides WHERE month = $1",
      [month]
    );
    return rows.map(rowToOverride);
  }
  const all = await readAllFile();
  return all.filter((o) => o.month === month);
}

/** Insert-or-replace by deterministic id. Returns the stored row. */
export async function upsertOverride(input: {
  scope: "business" | "agent";
  agentKey?: string;
  month: string;
  metric: string;
  value: number;
  note?: string;
}): Promise<ActualOverride> {
  const record: ActualOverride = {
    id: overrideId(input.scope, input.agentKey, input.month, input.metric),
    scope: input.scope,
    agentKey: input.scope === "agent" ? input.agentKey : undefined,
    month: input.month,
    metric: input.metric,
    value: input.value,
    note: input.note,
    updatedAt: new Date().toISOString(),
  };
  if (hasDb()) {
    await q(
      `INSERT INTO actual_overrides
         (id, scope, agent_key, month, metric, value, note, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         value      = EXCLUDED.value,
         note       = EXCLUDED.note,
         updated_at = EXCLUDED.updated_at`,
      [
        record.id,
        record.scope,
        record.agentKey ?? null,
        record.month,
        record.metric,
        record.value,
        record.note ?? null,
        record.updatedAt,
      ]
    );
    return record;
  }
  const all = await readAllFile();
  const idx = all.findIndex((o) => o.id === record.id);
  if (idx === -1) all.push(record);
  else all[idx] = record;
  await writeAllFile(all);
  return record;
}

/** Remove one override (figure falls back to live/snapshot). True if it existed. */
export async function deleteOverride(id: string): Promise<boolean> {
  if (hasDb()) {
    const rows = await q<{ id: string }>(
      "DELETE FROM actual_overrides WHERE id = $1 RETURNING id",
      [id]
    );
    return rows.length > 0;
  }
  const all = await readAllFile();
  const next = all.filter((o) => o.id !== id);
  if (next.length === all.length) return false;
  await writeAllFile(next);
  return true;
}
