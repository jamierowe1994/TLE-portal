import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { resolveRexUserId } from "@/lib/agent-link";
import { rexCall, rexRows } from "@/lib/rex";
import { getAgentCompliance, complianceFileUrl } from "@/lib/rex-stats";

// Streams a compliance certificate out of REX to the agent it belongs to.
//
// GET ?entry=<complianceEntryId> → the file bytes
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

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const entryId = req.nextUrl.searchParams.get("entry");
  // Ids only — this value goes into a REX query, and free text would let a
  // caller shape that query.
  if (!entryId || !/^\d+$/.test(entryId)) {
    return NextResponse.json({ error: "Bad entry id" }, { status: 400 });
  }

  // Authorisation. A session alone is not enough: entry ids are sequential, so
  // without this any agent could walk the range and read the whole agency's
  // certificates. Reuse the SAME boundary the compliance page renders from, so
  // the two can never drift apart — if it isn't on their page, they can't fetch
  // it. getAgentCompliance is short-cached, so this is usually free.
  const rexUserId = await resolveRexUserId(user);
  const properties = rexUserId ? await getAgentCompliance(rexUserId) : null;
  if (properties == null) {
    return NextResponse.json({ error: "Couldn't reach REX" }, { status: 502 });
  }
  const owned = properties.some((p) =>
    p.items.some((i) => i.entryId === entryId)
  );
  if (!owned) {
    // Deliberately the same answer as a genuinely absent document: a distinct
    // 403 would confirm the id exists on somebody else's property.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const res = await rexCall("ComplianceEntries", "search", {
    criteria: [{ name: "id", type: "=", value: entryId }],
    limit: 1,
  }).catch(() => null);
  if (!res || !res.ok) {
    return NextResponse.json({ error: "Couldn't reach REX" }, { status: 502 });
  }

  const url = complianceFileUrl(rexRows(res.result)[0] ?? {});
  if (!url) {
    // No document attached — the common case for EPCs and tenant ID checks.
    return NextResponse.json({ error: "No certificate attached" }, { status: 404 });
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
