import "server-only";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";
import { hasDb, q } from "@/lib/db";

// Last-good Propoly snapshots, persisted across deploys. The in-memory
// caches in lib/propoly-deals.ts die on every restart, and re-pulling the
// whole book (~30 calls) on each cold start is what tripped Propoly's rate
// limit. Now: every successful pull is saved here, and a cold start seeds
// from this store — Propoly is only asked for the *refresh*, and if it
// refuses (429/outage) the board still shows the last good data.

export interface Snapshot<T> {
  data: T;
  savedAt: number; // ms epoch
}

const FILE = path.join(DATA_DIR, "propoly-cache.json");

async function readFileStore(): Promise<Record<string, Snapshot<unknown>>> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function loadSnapshot<T>(key: string): Promise<Snapshot<T> | null> {
  try {
    if (hasDb()) {
      const rows = await q<{ data: string; updated_at: string | Date }>(
        "SELECT data, updated_at FROM propoly_cache WHERE key = $1",
        [key]
      );
      if (!rows[0]) return null;
      return {
        data: JSON.parse(rows[0].data) as T,
        savedAt: new Date(rows[0].updated_at).getTime(),
      };
    }
    const store = await readFileStore();
    return (store[key] as Snapshot<T> | undefined) ?? null;
  } catch {
    return null; // a broken snapshot must never break the live path
  }
}

/** Fire-and-forget from the fetchers — never throws. */
export async function saveSnapshot(key: string, data: unknown): Promise<void> {
  try {
    if (hasDb()) {
      await q(
        `INSERT INTO propoly_cache (key, data, updated_at) VALUES ($1,$2,NOW())
         ON CONFLICT (key) DO UPDATE SET data = $2, updated_at = NOW()`,
        [key, JSON.stringify(data)]
      );
      return;
    }
    const store = await readFileStore();
    store[key] = { data, savedAt: Date.now() };
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(store), "utf8");
  } catch {
    // best-effort — losing a snapshot write costs nothing
  }
}
