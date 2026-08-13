import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import {
  DocusignError,
  consentUrl,
  docusignConfigured,
  dsCall,
  getAccounts,
  getEnvelopeDocument,
} from "@/lib/docusign";

// Admin-only diagnostic for wiring DocuSign up, shaped like the PayProp probe.
//
// It answers three questions in order, and stops at the first failure so the
// output points at one thing to fix rather than a wall of red:
//
//   1. Does JWT authenticate at all?  The usual first-run answer is no, because
//      consent hasn't been granted — so a consent URL is handed back ready to
//      click, rather than leaving you to assemble one.
//   2. WHICH ACCOUNTS can this user see?  This is the real question. The REX
//      e-sign register shows one DocuSign connection carrying TLE, Property
//      Experts, Newman, Maxwell James and Prestige envelopes together, so
//      "the DocuSign for TLE" may well be the shared group account. The raw,
//      unfiltered account list settles it.
//   3. Can we read envelopes, and pull a document?
//
// Every call here also counts as the "recent API activity" DocuSign reviews
// before it will promote the integration key to production.
//
// GET /api/admin/docusign-probe                  → auth + accounts + recent envelopes
// GET /api/admin/docusign-probe?envelopeId=<id>  → also proves the PDF download
export async function GET(req: NextRequest) {
  const adminId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = adminId ? await findById(adminId) : null;
  if (!admin) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!isAdminEmail(admin.email)) {
    return NextResponse.json(
      { error: "This area is locked to the business owner." },
      { status: 403 }
    );
  }

  const environment = process.env.DOCUSIGN_ENV === "production" ? "production" : "demo";
  // Must match a Redirect URI registered on the app EXACTLY — character for
  // character, port included — or DocuSign rejects consent with
  // invalid_redirect_uri. The origin default is only a guess: the dev server
  // runs on 3100 while people habitually register 3000, so DOCUSIGN_REDIRECT_URI
  // exists to state the registered value outright rather than infer it.
  const redirectUri =
    process.env.DOCUSIGN_REDIRECT_URI?.trim() ||
    `${req.nextUrl.origin}/api/docusign/consent`;

  if (!docusignConfigured()) {
    return NextResponse.json({
      configured: false,
      environment,
      hint:
        "Add DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID and DOCUSIGN_PRIVATE_KEY " +
        "to .env.local (and Railway), then restart. DOCUSIGN_USER_ID is the API " +
        "user's GUID from Apps and Keys — not an email address. Leave " +
        "DOCUSIGN_ACCOUNT_ID unset and this probe will report what's available.",
    });
  }

  // --- 1 & 2: authenticate, and list what this user can actually reach -------
  let email = "";
  let accounts: Awaited<ReturnType<typeof getAccounts>>["accounts"] = [];
  try {
    ({ email, accounts } = await getAccounts());
  } catch (err) {
    const e = err as DocusignError;
    return NextResponse.json({
      configured: true,
      environment,
      authenticated: false,
      error: e.message,
      ...(e.needsConsent
        ? {
            needsConsent: true,
            consentUrl: consentUrl(redirectUri),
            hint:
              `Open the consentUrl as an admin of the ${environment} account and ` +
              `approve. ${redirectUri} must be registered on the app as a Redirect ` +
              "URI, character for character. The page it lands on does not need to " +
              "exist — consent is recorded before the redirect.",
          }
        : {}),
    });
  }

  // --- 3: read envelopes, newest first --------------------------------------
  // A 30-day window keeps the probe fast; from_date is required by DocuSign.
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  let envelopes: {
    window: string;
    count: number | null;
    recent: Array<{
      envelopeId: string;
      status: string;
      emailSubject: string;
      sentDateTime: string | null;
      completedDateTime: string | null;
    }>;
    error?: string;
  };
  try {
    const listed = await dsCall<{
      resultSetSize?: string;
      envelopes?: Array<Record<string, string>>;
    }>("envelopes", {
      query: { from_date: from, count: "5", order: "desc", order_by: "last_modified" },
    });
    envelopes = {
      window: `since ${from}`,
      count: listed.resultSetSize ? Number(listed.resultSetSize) : null,
      recent: (listed.envelopes ?? []).map((e) => ({
        envelopeId: e.envelopeId,
        status: e.status,
        emailSubject: e.emailSubject,
        sentDateTime: e.sentDateTime ?? null,
        completedDateTime: e.completedDateTime ?? null,
      })),
    };
  } catch (err) {
    envelopes = {
      window: `since ${from}`,
      count: null,
      recent: [],
      error: (err as Error).message,
    };
  }

  // --- optional: prove a document actually downloads ------------------------
  // Reports size and type only. The bytes are a signed agreement and have no
  // business being echoed into a diagnostic response.
  const envelopeId = req.nextUrl.searchParams.get("envelopeId")?.trim();
  let document: Record<string, unknown> | undefined;
  if (envelopeId) {
    try {
      const combined = await getEnvelopeDocument(envelopeId, "combined");
      const certificate = await getEnvelopeDocument(envelopeId, "certificate").catch(
        () => null
      );
      document = {
        envelopeId,
        combined: { bytes: combined.bytes.length, mime: combined.mime },
        certificate: certificate
          ? { bytes: certificate.bytes.length, mime: certificate.mime }
          : "unavailable",
      };
    } catch (err) {
      document = { envelopeId, error: (err as Error).message };
    }
  }

  return NextResponse.json({
    configured: true,
    environment,
    authenticated: true,
    user: { email },
    // The headline. More than one account here — or a name that isn't purely
    // TLE — means the same scoping discipline as REX applies.
    accountCount: accounts.length,
    accounts: accounts.map((a) => ({
      accountId: a.account_id,
      accountName: a.account_name,
      baseUri: a.base_uri,
      isDefault: a.is_default,
    })),
    envelopes,
    ...(document ? { document } : {}),
  });
}
