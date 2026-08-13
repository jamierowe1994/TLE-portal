import { NextRequest, NextResponse } from "next/server";
import {
  connectConfigured,
  findAgreementByEnvelope,
  parseConnectEvent,
  verifyConnectSignature,
} from "@/lib/docusign-connect";
import { docusignConfigured } from "@/lib/docusign";
import { fileAgreement } from "@/lib/docusign-filing";

// DocuSign Connect receiver: a landlord signs, the agreement lands in the file.
//
// PUBLIC ENDPOINT. Everything else under /api/admin is behind a session; this
// cannot be, because DocuSign is the caller. Its only defence is the HMAC, so:
//
//   • No HMAC key configured  → 503, refuse to process anything. An unsigned
//     webhook that writes documents into customer files is a hole, and
//     "temporarily allow it while we get set up" is how holes become permanent.
//   • Bad or missing signature → 401, nothing read, nothing written.
//
// Response codes are chosen for how Connect RETRIES them:
//   200  handled, or permanently unhandleable — do not send it again
//   401  rejected
//   500  transient (REX or DocuSign was down) — please retry
//
// Set up in DocuSign: Settings → Connect → Add Configuration, URL
// https://<portal-domain>/api/docusign/webhook, JSON, "Include HMAC signature"
// with the same secret as DOCUSIGN_CONNECT_HMAC_KEY, subscribed to
// envelope-completed.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!connectConfigured() || !docusignConfigured()) {
    return NextResponse.json(
      { error: "DocuSign Connect is not configured." },
      { status: 503 }
    );
  }

  // Raw body, before any parsing — the signature is over these exact bytes.
  const raw = await req.text();
  if (!verifyConnectSignature(raw, req.headers)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    // Signed but unparseable: retrying will not fix it.
    return NextResponse.json({ ok: true, ignored: "unparseable body" });
  }

  const { event, envelopeId } = parseConnectEvent(body);
  if (event !== "envelope-completed") {
    return NextResponse.json({ ok: true, ignored: event || "no event" });
  }
  if (!envelopeId) {
    return NextResponse.json({ ok: true, ignored: "no envelopeId" });
  }

  try {
    const agreement = await findAgreementByEnvelope(envelopeId);
    if (!agreement) {
      // Either not TLE's, or REX has no record of it. Not an error, and not
      // worth retrying — the backfill is the net for anything odd.
      return NextResponse.json({
        ok: true,
        envelopeId,
        filed: false,
        reason: "no matching TLE record in REX",
      });
    }
    const result = await fileAgreement(agreement);
    return NextResponse.json({
      ok: true,
      envelopeId,
      listingId: agreement.listingId,
      ...result,
    });
  } catch (err) {
    // REX or DocuSign fell over. 500 so Connect retries with backoff, rather
    // than us silently losing the one event that mattered.
    return NextResponse.json(
      { error: (err as Error).message, envelopeId },
      { status: 500 }
    );
  }
}
