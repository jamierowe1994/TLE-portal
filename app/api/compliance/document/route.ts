import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { resolveRexUserId } from "@/lib/agent-link";
import { rexCall, rexRows } from "@/lib/rex";
import {
  getAgentCompliance,
  getAgentListings,
  complianceFileUrl,
  rexUriToUrl,
} from "@/lib/rex-stats";

// Streams a REX file to the agent it belongs to.
//
// GET ?entry=<complianceEntryId>  → a compliance certificate
// GET ?doc=<documentId>          → a document attached to a listing
//
// This exists rather than putting REX's own URL on the page. REX serves these
// from two hosts, and the second is the reason for the whole route:
//
//   • uk-crm.cdns.rexsoftware.com — no query string at all. The URL IS the
//     credential: whoever holds it can read a landlord's certificate, for ever,
//     with no login and no expiry. Rendering that into HTML would turn every
//     screenshot, copied link and browser-history entry into a permanent leak.
//   • file-proxy.rexsoftware.com — signed with `exp` + `sig`. Measured lifetime
//     is 2 hours, so this one is not urgent, but it still can't be persisted in
//     a durable cache or left in a long-open tab.
//
// Resolving per request, behind our own session, handles both: the URL never
// reaches the client, and it is always fresh. Verified 3 Aug 2026 — a
// server-side fetch of both hosts returns 200 application/pdf.

export const dynamic = "force-dynamic";

const REX_FETCH_TIMEOUT_MS = 15_000;
// Certificates are PDFs and images. Passing an arbitrary upstream content-type
// through to the browser invites it to render something it shouldn't.
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/heic",
]);

/** The compliance certificate behind ?entry= — owned by this agent, or null. */
async function certificateUrl(
  entryId: string,
  rexUserId: string | null
): Promise<{ url: string | null; reachable: boolean }> {
  // Authorisation. A session alone is not enough: ids are sequential, so
  // without this any agent could walk the range and read the whole agency's
  // certificates. Reuse the SAME boundary the compliance page renders from, so
  // the two can never drift apart — if it isn't on their page, they can't fetch
  // it. getAgentCompliance is short-cached, so this is usually free.
  const properties = rexUserId ? await getAgentCompliance(rexUserId) : null;
  if (properties == null) return { url: null, reachable: false };
  if (!properties.some((p) => p.items.some((i) => i.entryId === entryId))) {
    return { url: null, reachable: true };
  }

  const res = await rexCall("ComplianceEntries", "search", {
    criteria: [{ name: "id", type: "=", value: entryId }],
    limit: 1,
  }).catch(() => null);
  if (!res || !res.ok) return { url: null, reachable: false };
  return { url: complianceFileUrl(rexRows(res.result)[0] ?? {}), reachable: true };
}

/** A file attached to one of this agent's listings behind ?doc=, or null. */
async function listingDocumentUrl(
  docId: string,
  rexUserId: string | null
): Promise<{ url: string | null; reachable: boolean }> {
  const res = await rexCall("Documents", "search", {
    criteria: [{ name: "id", type: "=", value: docId }],
    limit: 1,
  }).catch(() => null);
  if (!res || !res.ok) return { url: null, reachable: false };

  const row = rexRows(res.result)[0];
  const listingId = row ? String(row.listing_id ?? "") : "";
  if (!listingId) return { url: null, reachable: true };

  // Same rule as certificates: it has to be on a listing this agent holds.
  const listings = rexUserId ? await getAgentListings(rexUserId) : null;
  if (listings == null) return { url: null, reachable: false };
  if (!listings.some((l) => String(l.id) === listingId)) {
    return { url: null, reachable: true };
  }
  return { url: rexUriToUrl(row?.uri), reachable: true };
}

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const entryId = req.nextUrl.searchParams.get("entry");
  const docId = req.nextUrl.searchParams.get("doc");
  const id = entryId ?? docId;
  // Ids only — this value goes into a REX query, and free text would let a
  // caller shape that query.
  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Bad id" }, { status: 400 });
  }

  const rexUserId = await resolveRexUserId(user);
  const { url, reachable } = entryId
    ? await certificateUrl(entryId, rexUserId)
    : await listingDocumentUrl(id, rexUserId);

  if (!reachable) {
    return NextResponse.json({ error: "Couldn't reach REX" }, { status: 502 });
  }
  if (!url) {
    // Covers three cases on purpose — not yours, no document attached, or a
    // rexpm:// file we can't sign for. A distinct 403 would confirm an id
    // exists on somebody else's property.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REX_FETCH_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(url, { signal: controller.signal, cache: "no-store" });
  } catch {
    return NextResponse.json({ error: "Couldn't fetch the certificate" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Couldn't fetch the certificate" }, { status: 502 });
  }

  const upstreamType = (upstream.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const contentType = ALLOWED_TYPES.has(upstreamType)
    ? upstreamType
    : "application/octet-stream";

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      // A landlord's certificate is private — never let a shared cache hold it.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
