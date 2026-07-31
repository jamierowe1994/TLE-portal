import "server-only";
import { hasDb, q } from "@/lib/db";

// A durable cache for the slow integration walks.
//
// The in-memory cache alone means every deploy — and there have been a lot —
// throws away ~120 sequential PayProp requests and puts every tab back on the
// amber "fetching…" banner for minutes. Results are written here as well, so a
// fresh process serves the last known figures immediately and refreshes behind.
//
// Deliberately not a general cache: it holds a handful of small JSON blobs
// keyed by name, and a miss is always survivable.

interface Row extends Record<string, unknown> {
  payload: unknown;
  computed_at: string;
}

export async function readCache<T>(key: string): Promise<{ data: T; at: number } | null> {
  if (!hasDb()) return null;
  const rows = await q<Row>(
    "SELECT payload, computed_at FROM integration_cache WHERE key = $1",
    [key]
  ).catch(() => []);
  const r = rows[0];
  if (!r) return null;
  return { data: r.payload as T, at: new Date(r.computed_at).getTime() };
}

export async function writeCache(key: string, data: unknown): Promise<void> {
  if (!hasDb()) return;
  await q(
    `INSERT INTO integration_cache (key, payload, computed_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET
       payload = EXCLUDED.payload,
       computed_at = EXCLUDED.computed_at`,
    [key, JSON.stringify(data)]
  ).catch(() => {});
}
