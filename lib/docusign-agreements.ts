import "server-only";
import { rexCall, rexConfigured, rexRows } from "@/lib/rex";
import { readCache, writeCache } from "@/lib/integration-cache";

// The agreements register: every TLE DocuSign envelope, joined to a property.
//
// This is the layer [[rex-esign]] should have been. That module answers one
// narrow question — "has the landlord signed?" — keyed on listing id, and
// throws away everything else. This keeps the DocuSign ENVELOPE ID, which is
// what lets us fetch the signed PDF itself, and resolves the envelopes that
// hang off a property rather than a listing.
//
// Measured against the live register on 13 Aug 2026 (946 rows, complete walk):
//
//   616  TLE envelopes (of 946 — the REX account is shared with five other
//        businesses, so scoping is not optional)
//   387    carry content.listing.id directly
//   149    carry only content.property.id, but that property HAS a listing
//    80    unreachable: the property has no listing in REX at all. A Terms of
//          Business gets signed at instruction, sometimes before a listing
//          record exists — or one was never created. Not a bug to fix; a real
//          share of the book that has nowhere to be filed.
//   309  completed, across 272 properties — the signed PDFs available today.
//
// Two traps, both paid for in debugging:
//   • REX's `property_id in [...]` criterion silently under-returns on a long
//     array — it reported ZERO matches for 155 ids that individually resolve
//     fine. Resolution is therefore one property per call. Slow, but true.
//   • Only a COMPLETE walk is ever cached. A partial one would quietly report
//     "no agreement on file" for a property whose envelope sat on an unwalked
//     page, and absence is indistinguishable from a real answer in the UI.

export interface Agreement {
  /** The DocuSign envelope id — `provider_request_id` in REX. The join key. */
  envelopeId: string;
  /** Resolved listing id, or null when the property has no listing. */
  listingId: string | null;
  propertyId: string | null;
  /** REX's own status ids: completed | partially_signed | sent | failed. */
  status: string;
  subject: string;
  /** DocuSign template id — the reliable signal of WHICH agreement this is. */
  templateId: string | null;
  sentAt: string | null;
  completedAt: string | null;
  /** Non-staff signers: the landlords. Staff roles are dropped. */
  signers: Array<{ name: string; email: string }>;
}

const CACHE_KEY = "docusign:agreements:v1";
const TTL_MS = 60 * 60_000;
const FAILURE_COOLDOWN_MS = 60_000;
const PAGE = 100;
const MAX_PAGES = 20;
/** Concurrency for the one-at-a-time property lookups. REX is not fast. */
const RESOLVE_CONCURRENCY = 6;

let cache: { at: number; rows: Agreement[] } | null = null;
let running = false;
let failedAt = 0;

/**
 * TLE's own envelopes, out of a register shared with Property Experts, Newman,
 * Maxwell James, Prestige and Commercial. Subject line is the honest signal:
 * agent email domain is NOT usable here, because TLE partners sit on both
 * domains — see the note in [[rex-agent-filter-and-appraisal-type]].
 */
const TLE_SUBJECT = /TLE[_ ]|letting.?experts/i;

export function isTleAgreement(subject: string): boolean {
  return TLE_SUBJECT.test(subject);
}

/** REX system_* times are epoch SECONDS — casting to string yields a 1970. */
function stamp(v: unknown): string | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** One property → its listing. Null when REX holds no listing for it. */
async function listingForProperty(propertyId: string): Promise<string | null> {
  const res = await rexCall("Listings", "search", {
    criteria: [{ name: "property_id", type: "=", value: propertyId }],
    limit: 3,
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const rows = rexRows(res.result);
  return rows.length ? str(rows[0].id) : null;
}

async function resolveProperties(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const queue = [...ids];
  await Promise.all(
    Array.from({ length: RESOLVE_CONCURRENCY }, async () => {
      for (let id = queue.pop(); id; id = queue.pop()) {
        const listingId = await listingForProperty(id);
        if (listingId) out[id] = listingId;
      }
    })
  );
  return out;
}

async function walk(): Promise<Agreement[] | null> {
  const raw: Array<Record<string, unknown>> = [];
  let complete = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await rexCall("EsignRequests", "search", {
      limit: PAGE,
      offset: page * PAGE,
    }).catch(() => null);
    if (!res || !res.ok) return null; // incomplete — do NOT cache
    const batch = rexRows(res.result);
    raw.push(...batch);
    if (batch.length < PAGE) {
      complete = true;
      break;
    }
  }
  if (!complete) return null;

  const mine = raw.filter((r) => {
    const content = (r.content ?? {}) as Record<string, unknown>;
    return isTleAgreement(str(content.email_subject));
  });

  // Resolve the property-only envelopes in one pass, not per row.
  const needed = new Set<string>();
  for (const r of mine) {
    const content = (r.content ?? {}) as Record<string, unknown>;
    const listing = (content.listing ?? {}) as Record<string, unknown>;
    const property = (content.property ?? {}) as Record<string, unknown>;
    if (!listing.id && property.id) needed.add(str(property.id));
  }
  const resolved = await resolveProperties([...needed]);

  const out: Agreement[] = [];
  for (const r of mine) {
    const envelopeId = str(r.provider_request_id);
    if (!envelopeId) continue; // no envelope id, no document — skip, don't invent
    const content = (r.content ?? {}) as Record<string, unknown>;
    const listing = (content.listing ?? {}) as Record<string, unknown>;
    const property = (content.property ?? {}) as Record<string, unknown>;
    const status = str(
      ((r.status ?? {}) as Record<string, unknown>).id
    ).toLowerCase();
    if (!status) continue; // an invented status is an invented answer

    const propertyId = property.id ? str(property.id) : null;
    const listingId = listing.id
      ? str(listing.id)
      : propertyId
        ? (resolved[propertyId] ?? null)
        : null;

    const roles = Array.isArray(content.roles) ? content.roles : [];
    const signers = roles
      .map((x) => (x ?? {}) as Record<string, unknown>)
      // role_type "user" is TLE staff; "contact" is the landlord.
      .filter((x) => str(x.role_type) === "contact")
      .map((x) => {
        const rec = (x.record ?? {}) as Record<string, unknown>;
        return { name: str(rec.name), email: str(rec.email_address) };
      })
      .filter((s) => s.name || s.email);

    out.push({
      envelopeId,
      listingId,
      propertyId,
      status,
      subject: str(content.email_subject),
      templateId: r.provider_template_id ? str(r.provider_template_id) : null,
      sentAt: stamp(r.system_sent_time),
      completedAt: stamp(r.system_completed_time),
      signers,
    });
  }
  return out.length ? out : null;
}

/**
 * Never blocks: serves the durable cache (however stale) and refreshes behind.
 * null means "register not loaded yet" — render nothing rather than an empty
 * state, because "no agreements" and "not loaded" must not look the same.
 */
export async function getAgreements(): Promise<Agreement[] | null> {
  if (!rexConfigured()) return null;
  if (!cache) {
    const stored = await readCache<Agreement[]>(CACHE_KEY).catch(() => null);
    if (stored) cache = { at: stored.at, rows: stored.data };
  }
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  if (!running && Date.now() - failedAt > FAILURE_COOLDOWN_MS) {
    running = true;
    void (async () => {
      const rows = await walk();
      if (rows) {
        cache = { at: Date.now(), rows };
        failedAt = 0;
        await writeCache(CACHE_KEY, rows);
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
  return cache?.rows ?? null;
}

/** Agreements on one property, newest first. null = register not loaded. */
export async function getAgreementsForListing(
  listingId: string
): Promise<Agreement[] | null> {
  const all = await getAgreements();
  if (!all) return null;
  return all
    .filter((a) => a.listingId === listingId)
    .sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));
}
