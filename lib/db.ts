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
  portfolio_target NUMERIC,
  move_ins_target  NUMERIC,
  ma_target        NUMERIC,
  notes            TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, month)
);
ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS portfolio_target NUMERIC;

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

CREATE TABLE IF NOT EXISTS assistant_knowledge (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  content          TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS todos (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  note             TEXT NOT NULL,
  due_at           TEXT,
  platform         TEXT,
  property         TEXT,
  tenant           TEXT,
  done             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS todos_user_idx ON todos (user_id);

-- Pre-tenancy overlay on Propoly deals (lib/deal-store.ts): two-way notes
-- between Kirstie and the agents, manual stage moves, checklist ticks.
CREATE TABLE IF NOT EXISTS deal_notes (
  id               TEXT PRIMARY KEY,
  deal_id          TEXT NOT NULL,
  author_id        TEXT NOT NULL,
  author_name      TEXT NOT NULL DEFAULT '',
  author_role      TEXT NOT NULL DEFAULT 'agent',
  text             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS deal_notes_deal_idx ON deal_notes (deal_id);
-- kind: 'note' (shared activity) · 'system' (auto-logged event) · 'private'
-- (author-only — filtered to the author on read)
ALTER TABLE deal_notes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'note';

-- Kirstie can pull a deal back out of the archive. The archive itself is a
-- RULE (move-in slipped more than 30 days), not a stored state, so only the
-- exception needs persisting — otherwise every deal would need writing to the
-- moment it aged past the threshold.
ALTER TABLE deal_meta ADD COLUMN IF NOT EXISTS unarchived_at TIMESTAMPTZ;

-- Property notes (lib/property-notes-store.ts): the conversation log on a
-- property drawer — agents and the pre-tenancy team leaving each other notes
-- against a REX listing id.
CREATE TABLE IF NOT EXISTS property_notes (
  id               TEXT PRIMARY KEY,
  listing_id       TEXT NOT NULL,
  author_id        TEXT NOT NULL,
  author_name      TEXT NOT NULL DEFAULT '',
  author_role      TEXT NOT NULL DEFAULT 'agent',
  text             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS property_notes_listing_idx ON property_notes (listing_id);

-- PayProp OAuth. Railway's filesystem is wiped on every deploy, so a token
-- kept on disk survives exactly until the next one — it has to live here.
CREATE TABLE IF NOT EXISTS payprop_tokens (
  account          TEXT PRIMARY KEY,
  refresh_token    TEXT NOT NULL,
  connected_by     TEXT NOT NULL DEFAULT '',
  connected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scopes           TEXT
);

-- Results of the slow PayProp/REX walks. Held in memory too, but that dies
-- with the process: without this every deploy costs another few minutes of
-- amber "fetching…" banners before any figure appears.
CREATE TABLE IF NOT EXISTS integration_cache (
  key              TEXT PRIMARY KEY,
  payload          JSONB NOT NULL,
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Follow-ups Kirstie sets herself against a deal ("Tasks" tab + Tasks today).
CREATE TABLE IF NOT EXISTS deal_tasks (
  id               TEXT PRIMARY KEY,
  deal_id          TEXT NOT NULL,
  deal_label       TEXT NOT NULL DEFAULT '',
  user_id          TEXT NOT NULL,
  title            TEXT NOT NULL,
  due_date         TEXT,
  done             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS deal_tasks_user_idx ON deal_tasks (user_id, due_date);
CREATE INDEX IF NOT EXISTS deal_tasks_deal_idx ON deal_tasks (deal_id);

-- Per-user IMAP mailbox for the Emails tab. secret = AES-256-GCM encrypted
-- app password (key derived from AUTH_SECRET) — never stored in the clear.
CREATE TABLE IF NOT EXISTS user_mailboxes (
  user_id          TEXT PRIMARY KEY,
  email            TEXT NOT NULL,
  imap_host        TEXT NOT NULL,
  imap_port        INTEGER NOT NULL DEFAULT 993,
  secret           TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deal_meta (
  deal_id          TEXT PRIMARY KEY,
  stage_override   TEXT,
  stage_based_on   TEXT,
  stage_by         TEXT,
  stage_at         TIMESTAMPTZ,
  checklist        JSONB NOT NULL DEFAULT '{}',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Last-good Propoly pulls (lib/propoly-snapshot.ts). Survives deploys so a
-- restart serves data instantly instead of re-pulling the whole book — the
-- re-pull habit is what tripped Propoly's rate limit on 22 Jul 2026.
CREATE TABLE IF NOT EXISTS propoly_cache (
  key              TEXT PRIMARY KEY,
  data             TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Finalised live funnel figures for CLOSED months. Once a month has passed
-- its numbers can't change, so we pull them from REX/Propoly once, store
-- them, and never re-query (James: "once they're pulled, they're pulled").
CREATE TABLE IF NOT EXISTS history_funnels (
  month            TEXT PRIMARY KEY,          -- "YYYY-MM"
  data             TEXT NOT NULL,             -- JSON HistoryFunnel
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
