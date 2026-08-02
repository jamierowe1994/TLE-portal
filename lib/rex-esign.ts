import "server-only";
import { rexCall, rexConfigured, rexRows } from "@/lib/rex";
import { readCache, writeCache } from "@/lib/integration-cache";

// Landlord Terms-of-Business signing state, from REX's DocuSign log.
//
// EsignRequests holds every DocuSign envelope REX has sent — 942 rows on
// 2 Aug 2026, and every single one is landlord-facing (ToB, marketing
// agreements): the probe found zero tenant tenancy agreements, so this
// register answers "has the LANDLORD signed?" and nothing about tenants.
//
// Shaped exactly like the other registers (portfolio book, tenancy register)
// after review: durable cache so a deploy doesn't cold-start into a blocking
// walk, serve-stale-refresh-behind so no caller ever awaits the walk, a
// failure cooldown so a REX outage doesn't re-fire it per request, and only a
// COMPLETE walk is ever cached — a partial one would confidently show "sent,
// not yet signed" for a landlord whose signature sat on the unwalked pages.

export interface TobStatus {
  /** REX's own ids: "completed" | "partially_signed" | "sent" | "failed" |
   *  anything new REX invents — the UI must not flatten unknowns. */
  status: string;
  sentAt: string | null;
  completedAt: string | null;
}

const CACHE_KEY = "rex:tob-register:v1";
const TTL_MS = 60 * 60_000;
const FAILURE_COOLDOWN_MS = 60_000;

let cache: { at: number; byListingId: Record<string, TobStatus> } | null = null;
let running = false;
let failedAt = 0;

/** Signing rank — a completed envelope beats anything else on the listing. */
const RANK: Record<string, number> = {
  completed: 3,
  partially_signed: 2,
  sent: 1,
  failed: 0,
};

/** REX system_* times are epoch SECONDS. Casting them to string produced a
 *  confident 1970 in the tooltip (review find) — convert or return null. */
function stamp(v: unknown): string | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

async function walkRegister(): Promise<Record<string, TobStatus> | null> {
  const byListingId: Record<string, TobStatus> = {};
  let complete = false;
  for (let page = 0; page < 20; page++) {
    const res = await rexCall("EsignRequests", "search", {
      limit: 100,
      offset: page * 100,
    }).catch(() => null);
    if (!res || !res.ok) break; // incomplete — do NOT cache
    const batch = rexRows(res.result);
    for (const r of batch) {
      const content = (r.content ?? {}) as Record<string, unknown>;
      const listing = (content.listing ?? {}) as Record<string, unknown>;
      const listingId = String(listing.id ?? "");
      if (!listingId) continue;
      // No coercion: a row without a readable status is skipped, not invented
      // as "sent" — an invented status is an invented answer.
      const status = String(
        ((r.status ?? {}) as Record<string, unknown>).id ?? ""
      ).toLowerCase();
      if (!status) continue;
      const next: TobStatus = {
        status,
        sentAt: stamp(r.system_sent_time),
        completedAt: stamp(r.system_completed_time),
      };
      const prev = byListingId[listingId];
      if (!prev || (RANK[status] ?? 0) > (RANK[prev.status] ?? 0)) {
        byListingId[listingId] = next;
      }
    }
    if (batch.length < 100) {
      complete = true;
      break;
    }
  }
  return complete && Object.keys(byListingId).length > 0 ? byListingId : null;
}

/**
 * Never blocks: serves the durable cache (however stale) and refreshes behind.
 * null means "register not loaded yet" — callers must render nothing, because
 * an absent pill is honest and "TOB SENT" from a guess is not.
 */
export async function getTobRegister(): Promise<Record<string, TobStatus> | null> {
  if (!rexConfigured()) return null;
  if (!cache) {
    const stored = await readCache<Record<string, TobStatus>>(CACHE_KEY).catch(
      () => null
    );
    if (stored) cache = { at: stored.at, byListingId: stored.data };
  }
  if (cache && Date.now() - cache.at < TTL_MS) return cache.byListingId;
  if (!running && Date.now() - failedAt > FAILURE_COOLDOWN_MS) {
    running = true;
    void (async () => {
      const data = await walkRegister();
      if (data) {
        cache = { at: Date.now(), byListingId: data };
        failedAt = 0;
        await writeCache(CACHE_KEY, data);
      } else {
        failedAt = Date.now();
      }
    })()
      .catch(() => {
        failedAt = Date.now();
      })
      .finally(() => {
        running = false;
      });
  }
  return cache?.byListingId ?? null;
}
