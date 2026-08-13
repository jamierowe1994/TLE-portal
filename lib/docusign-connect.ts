import "server-only";
import crypto from "crypto";
import { rexCall, rexConfigured, rexRows } from "@/lib/rex";
import {
  isTleAgreement,
  listingForProperty,
  parseAgreementRow,
  type Agreement,
} from "@/lib/docusign-agreements";

// DocuSign Connect: the live half of the integration.
//
// The backfill walks history on demand; this reacts the moment a landlord
// finishes signing, so the agreement is in the property file in seconds rather
// than whenever the hourly register happens to refresh.
//
// The backfill remains the safety net, not a redundancy. A webhook can be
// missed — the app can be mid-deploy, DocuSign can give up retrying, an
// envelope can be sent from DocuSign directly and never reach REX. Anything
// this misses, the next backfill picks up. Neither is expected to be complete
// on its own.

/** Connect signs each POST with the shared secret from its configuration. */
const HMAC_HEADER_PREFIX = "x-docusign-signature-";

export function connectConfigured(): boolean {
  return !!process.env.DOCUSIGN_CONNECT_HMAC_KEY;
}

/**
 * Verify Connect's HMAC over the RAW body.
 *
 * Must be the raw bytes: re-serialising the parsed JSON changes whitespace and
 * key order, and the signature stops matching for reasons that look like a
 * configuration problem for an hour.
 *
 * DocuSign sends up to three signatures (…-1, …-2, …-3) so a secret can be
 * rotated without downtime; any one matching is a pass.
 */
export function verifyConnectSignature(
  rawBody: string,
  headers: Headers
): boolean {
  const secret = process.env.DOCUSIGN_CONNECT_HMAC_KEY;
  if (!secret) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  for (let i = 1; i <= 3; i++) {
    const got = headers.get(`${HMAC_HEADER_PREFIX}${i}`);
    if (!got) continue;
    const gotBuf = Buffer.from(got);
    // Length check first: timingSafeEqual throws on a length mismatch.
    if (gotBuf.length !== expectedBuf.length) continue;
    if (crypto.timingSafeEqual(gotBuf, expectedBuf)) return true;
  }
  return false;
}

export interface ConnectEvent {
  event: string;
  envelopeId: string | null;
  accountId: string | null;
}

/** Read the bits we act on out of a Connect JSON payload. */
export function parseConnectEvent(body: unknown): ConnectEvent {
  const b = (body ?? {}) as Record<string, unknown>;
  const data = (b.data ?? {}) as Record<string, unknown>;
  return {
    event: typeof b.event === "string" ? b.event : "",
    envelopeId: typeof data.envelopeId === "string" ? data.envelopeId : null,
    accountId: typeof data.accountId === "string" ? data.accountId : null,
  };
}

/**
 * Find the REX record for a just-completed envelope.
 *
 * REX cannot be searched by `provider_request_id` — it is not a searchable
 * field, and passing it returns an error rather than a filtered result. What
 * IS searchable is `system_completed_time`, and that filter is genuinely
 * respected (verified: 21 rows in a 30-day window, none outside it). So the
 * lookup is "everything completed recently, then match on envelope id" — a
 * handful of rows at TLE's ~30 completions a month.
 *
 * Returns null when REX has no record of the envelope. That is a real case,
 * not an error: an envelope sent from DocuSign directly never enters REX's
 * log, and there is no property to file it against.
 */
export async function findAgreementByEnvelope(
  envelopeId: string,
  windowDays = 7
): Promise<Agreement | null> {
  if (!rexConfigured()) return null;
  const cutoff = Math.floor(Date.now() / 1000) - windowDays * 24 * 3600;

  const res = await rexCall("EsignRequests", "search", {
    criteria: [{ name: "system_completed_time", type: ">=", value: cutoff }],
    limit: 100,
  }).catch(() => null);
  if (!res || !res.ok) return null;

  const row = rexRows(res.result).find(
    (r) => String(r.provider_request_id ?? "") === envelopeId
  );
  if (!row) return null;

  const parsed = parseAgreementRow(row);
  if (!parsed) return null;
  // Scoped here as well as in the register: the REX account is shared with
  // five other businesses, and their envelopes must not land in TLE's files.
  if (!isTleAgreement(parsed.subject)) return null;

  if (!parsed.listingId && parsed.propertyId) {
    parsed.listingId = await listingForProperty(parsed.propertyId);
  }
  return parsed;
}
