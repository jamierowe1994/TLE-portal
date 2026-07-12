import "server-only";
import { Pool } from "pg";

// Dual persistence switch: DATABASE_URL set (Railway Postgres) → pg store;
// unset → JSON files under DATA_DIR (lib/data-dir.ts). Same pattern as TEG.

export function hasDb(): boolean {
  return !!process.env.DATABASE_URL;
}

// Railway internal networking + localhost don't want SSL; everything else does.
function needsSsl(url: string): boolean {
  return !/railway\.internal|localhost|127\.0\.0\.1/.test(url);
}

// Cache the pool on globalThis so dev hot-reloads don't leak connections.
declare global {
  // eslint-disable-next-line no-var
  var __tlePool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __tleSchemaReady: Promise<void> | undefined;
}

function getPool(): Pool {
  if (!globalThis.__tlePool) {
    const url = process.env.DATABASE_URL!;
    globalThis.__tlePool = new Pool({
      connectionString: url,
      max: 5,
      ssl: needsSsl(url) ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalThis.__tlePool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL DEFAULT '',
  email            TEXT NOT NULL UNIQUE,
  mobile           TEXT NOT NULL DEFAULT '',
  photo            TEXT,
  agent_key        TEXT,
  rex_user_id      TEXT,
  meta_campaign_id TEXT,
  location         TEXT,
  admin_notes      JSONB NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  password_hash    TEXT NOT NULL,
  ads_connected    BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS ads_connected BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS forecasts (
  user_id          TEXT NOT NULL,
  month            TEXT NOT NULL,
  gci_target       NUMERIC,
  move_ins_target  NUMERIC,
  ma_target        NUMERIC,
  notes            TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, month)
);

CREATE TABLE IF NOT EXISTS actual_overrides (
  id               TEXT PRIMARY KEY,
  scope            TEXT NOT NULL,
  agent_key        TEXT,
  month            TEXT NOT NULL,
  metric           TEXT NOT NULL,
  value            NUMERIC NOT NULL,
  note             TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

// Schema is created lazily on first query; the promise is cached and reset on
// failure so a transient outage retries next call.
function ensureSchema(): Promise<void> {
  if (!globalThis.__tleSchemaReady) {
    globalThis.__tleSchemaReady = getPool()
      .query(SCHEMA)
      .then(() => undefined)
      .catch((err) => {
        globalThis.__tleSchemaReady = undefined;
        throw err;
      });
  }
  return globalThis.__tleSchemaReady;
}

/** Query helper — ensures schema, then runs the query. */
export async function q<Row extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<Row[]> {
  await ensureSchema();
  const res = await getPool().query(text, params as unknown[] as never[]);
  return res.rows as Row[];
}
