import "server-only";
import crypto from "crypto";

// DocuSign eSignature client — JWT Grant (service integration).
//
// Why JWT and not Authorization Code: nothing here runs with a human present.
// A Connect webhook fires at 2am; a backfill runs on a schedule. Authorization
// Code would need someone to click "allow" and keep re-consenting. JWT
// impersonates one service user forever, after a single admin consent.
//
// What this is FOR: reading envelopes and pulling the signed PDF. REX already
// logs every envelope it sent (EsignRequests.provider_request_id IS the
// DocuSign envelope id — 946/946 rows carry one), but REX exposes status only
// and no download. This is the only route to the document itself.
//
// SCOPING WARNING: the DocuSign account is shared across the six businesses,
// exactly like the REX account. A single connection carries TLE, Property
// Experts, Newman, Maxwell James and Prestige envelopes together. Never treat
// "it came from this account" as "it's TLE's" — scope by template/subject at
// the point of use.
//
// Config via env (secrets live in Railway, never in the repo):
//   DOCUSIGN_INTEGRATION_KEY — the app's client id (a GUID)
//   DOCUSIGN_USER_ID         — the API user's GUID to impersonate (NOT an email)
//   DOCUSIGN_PRIVATE_KEY     — RSA private key PEM. Newlines may be literal \n
//   DOCUSIGN_ACCOUNT_ID      — optional; discovered from userinfo if unset
//   DOCUSIGN_ENV             — "demo" (default) | "production"
//
// Demo and production are SEPARATE worlds with separate hosts. An integration
// key is born in demo and only reaches production via Go-Live promotion, so
// this defaults to demo and must be flipped deliberately.
//
// IMPORTANT: nothing runs at import time — every env read and network call is
// lazy, so the portal builds and demos with zero DocuSign env vars set.

const TOKEN_LIFETIME = 60 * 60; // seconds — DocuSign's hard ceiling for a JWT assertion
const TOKEN_SKEW_MS = 5 * 60 * 1000; // refresh 5 min early, same as the Rex client
const CALL_TIMEOUT_MS = 15_000; // higher than Rex's 8s: PDF downloads are megabytes

export interface DocusignUserInfo {
  /** Per-account REST base, e.g. https://demo.docusign.net/restapi */
  baseUri: string;
  accountId: string;
  accountName: string;
  email: string;
}

function oauthHost(): string {
  return process.env.DOCUSIGN_ENV === "production"
    ? "account.docusign.com"
    : "account-d.docusign.com";
}

export function docusignConfigured(): boolean {
  return !!(
    process.env.DOCUSIGN_INTEGRATION_KEY &&
    process.env.DOCUSIGN_USER_ID &&
    process.env.DOCUSIGN_PRIVATE_KEY
  );
}

/** Railway env vars can't hold real newlines, so a PEM arrives with literal \n. */
function privateKey(): string {
  return (process.env.DOCUSIGN_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url");

/**
 * The one-time consent URL. JWT impersonation is refused until an admin has
 * granted it once — the failure is `consent_required`, and this is the cure.
 * Open it as an admin of the target account and approve.
 */
export function consentUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    scope: "signature impersonation",
    client_id: process.env.DOCUSIGN_INTEGRATION_KEY ?? "",
    redirect_uri: redirectUri,
  });
  return `https://${oauthHost()}/oauth/auth?${params}`;
}

// One cached token per process. DocuSign caps assertion life at 1 hour.
let tokenCache: { token: string; expiresAt: number } | null = null;

export class DocusignError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when an admin still needs to grant consent — see consentUrl(). */
    readonly needsConsent = false
  ) {
    super(message);
    this.name = "DocusignError";
  }
}

async function requestToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // `aud` is the bare OAuth host with no scheme — a full URL here is rejected.
  const payload = b64url(
    JSON.stringify({
      iss: process.env.DOCUSIGN_INTEGRATION_KEY,
      sub: process.env.DOCUSIGN_USER_ID,
      aud: oauthHost(),
      iat: now,
      exp: now + TOKEN_LIFETIME,
      scope: "signature impersonation",
    })
  );
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(`${header}.${payload}`)
    .sign(privateKey());
  const assertion = `${header}.${payload}.${b64url(signature)}`;

  const res = await fetch(`https://${oauthHost()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = String(body.error ?? "unknown_error");
    // Called out by name because it's the near-universal first-run failure and
    // the error alone ("consent_required") tells you nothing about the fix.
    if (err === "consent_required") {
      throw new DocusignError(
        "DocuSign needs one-time admin consent for this integration key. " +
          "Open consentUrl() as an account admin and approve it.",
        res.status,
        true
      );
    }
    throw new DocusignError(
      `DocuSign token request failed: ${err}${
        body.error_description ? ` — ${body.error_description}` : ""
      }`,
      res.status
    );
  }
  const token = String(body.access_token ?? "");
  if (!token) throw new DocusignError("DocuSign returned no access token.", 500);
  tokenCache = {
    token,
    expiresAt: Date.now() + Number(body.expires_in ?? TOKEN_LIFETIME) * 1000,
  };
  return token;
}

async function accessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - TOKEN_SKEW_MS) {
    return tokenCache.token;
  }
  return requestToken();
}

export interface DocusignAccount {
  account_id: string;
  account_name: string;
  base_uri: string;
  is_default: boolean;
}

/**
 * Every account the impersonated user can reach, plus their login email.
 *
 * Deliberately raw and unfiltered: this is how we find out whether the
 * DocuSign we've been given is TLE-only or the shared group account, and a
 * probe that pre-filtered would hide exactly the answer we're looking for.
 */
export async function getAccounts(): Promise<{
  email: string;
  accounts: DocusignAccount[];
}> {
  const token = await accessToken();
  const res = await fetch(`https://${oauthHost()}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new DocusignError("DocuSign userinfo failed.", res.status);
  }
  const body = (await res.json()) as {
    email?: string;
    accounts?: DocusignAccount[];
  };
  return { email: body.email ?? "", accounts: body.accounts ?? [] };
}

// The REST base differs per account and per environment, so it's discovered
// rather than guessed. Cached for the process: it does not change.
let userInfoCache: DocusignUserInfo | null = null;

export async function getUserInfo(): Promise<DocusignUserInfo> {
  if (userInfoCache) return userInfoCache;
  const { email, accounts } = await getAccounts();
  const body = { email };
  const wanted = process.env.DOCUSIGN_ACCOUNT_ID;
  // An explicit account id wins; otherwise the default. Picking accounts[0]
  // blind would be a coin toss on a shared, multi-business login.
  const account =
    (wanted && accounts.find((a) => a.account_id === wanted)) ||
    accounts.find((a) => a.is_default) ||
    accounts[0];
  if (!account) {
    throw new DocusignError("DocuSign returned no accounts for this user.", 404);
  }
  if (wanted && account.account_id !== wanted) {
    throw new DocusignError(
      `DOCUSIGN_ACCOUNT_ID ${wanted} is not available to this API user.`,
      403
    );
  }
  userInfoCache = {
    baseUri: `${account.base_uri}/restapi`,
    accountId: account.account_id,
    accountName: account.account_name,
    email: body.email ?? "",
  };
  return userInfoCache;
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A JSON call against the account's REST base. `path` is relative to the
 * account, e.g. `envelopes/{id}` — no leading slash.
 */
export async function dsCall<T = unknown>(
  path: string,
  init: { method?: string; query?: Record<string, string>; body?: unknown } = {}
): Promise<T> {
  const [token, info] = await Promise.all([accessToken(), getUserInfo()]);
  const qs = init.query ? `?${new URLSearchParams(init.query)}` : "";
  const url = `${info.baseUri}/v2.1/accounts/${info.accountId}/${path}${qs}`;
  const res = await withTimeout((signal) =>
    fetch(url, {
      method: init.method ?? "GET",
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    })
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new DocusignError(
      `DocuSign ${init.method ?? "GET"} ${path} failed: ${text.slice(0, 300)}`,
      res.status
    );
  }
  return (await res.json()) as T;
}

/**
 * Download an envelope's documents as bytes.
 *
 * `documentId` accepts DocuSign's specials: "combined" (every document in one
 * PDF), "certificate" (the certificate of completion — the audit trail proving
 * who signed and when), or "archive" (a zip). "combined" is what belongs in a
 * property file.
 */
export async function getEnvelopeDocument(
  envelopeId: string,
  documentId: "combined" | "certificate" | "archive" | string = "combined"
): Promise<{ bytes: Buffer; mime: string }> {
  const [token, info] = await Promise.all([accessToken(), getUserInfo()]);
  const url = `${info.baseUri}/v2.1/accounts/${info.accountId}/envelopes/${envelopeId}/documents/${documentId}`;
  const res = await withTimeout((signal) =>
    fetch(url, { signal, headers: { Authorization: `Bearer ${token}` } })
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new DocusignError(
      `DocuSign document download failed for ${envelopeId}: ${text.slice(0, 300)}`,
      res.status
    );
  }
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    mime: res.headers.get("content-type") ?? "application/pdf",
  };
}
