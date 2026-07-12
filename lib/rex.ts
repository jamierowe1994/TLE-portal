import "server-only";

// REX CRM client for The Lettings Expert portal — ported from the TEG PAID
// ADS repo's lib/rex.ts (TLE shares the Property/Lettings REX account).
//
// Rex API shape (api-docs.rexsoftware.com):
//   • Every call is POST {BASE}/v1/rex/{Service}/{method}, JSON body. Rex only
//     accepts POST — even reads.
//   • Auth: POST /v1/rex/Authentication/login { email, password, token_lifetime,
//     account_id? } returns a token (GUID) — bare string or { token }. Sent as
//     `Authorization: Bearer <token>` on every other call.
//   • Responses are a { result, error } envelope. Treat any envelope `error`
//     as failure even on HTTP 200. Search results may be a bare array or
//     { rows: [...] } — handle both.
//
// Config via env (secret — lives in Railway, never in the repo):
//   REX_API_EMAIL / REX_API_PASSWORD — dedicated API user login. Required.
//   REX_API_BASE   — base URL. Defaults to the UK host.
//   REX_ACCOUNT_ID — the Rex account id to log into. TLE shares the
//                    Property/Lettings account — copy REX_ACCOUNT_LETTINGS
//                    from the TEG Railway project.
//
// IMPORTANT: nothing here runs at import time — all env reads and network
// calls are lazy, so the portal builds and demos with zero env vars set.

const TOKEN_LIFETIME = 4 * 60 * 60; // seconds — Rex resets on activity; 4h covers a burst
const TOKEN_SKEW_MS = 5 * 60 * 1000; // refresh 5 min before expiry
const CALL_TIMEOUT_MS = 8_000; // hard per-call ceiling — a stats pull must never hang a page

function base(): string {
  return process.env.REX_API_BASE ?? "https://api.uk.rexsoftware.com";
}

export function rexConfigured(): boolean {
  return !!(process.env.REX_API_EMAIL && process.env.REX_API_PASSWORD);
}

function rexAccountId(): string | null {
  return process.env.REX_ACCOUNT_ID || null;
}

export interface RexResponse {
  status: number;
  ok: boolean; // HTTP ok AND no `error` in the envelope
  result: unknown;
  error: string | null;
}

// One token per account id (a single Rex API user can access multiple accounts).
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function accountKey(accountId: string | null): string {
  return accountId ?? "__default__";
}

function isTokenError(res: RexResponse): boolean {
  const e = (res.error ?? "").toLowerCase();
  return res.status === 401 || e.includes("token") || e.includes("authenticate");
}

// Raw POST to a Rex service/method. Does NOT attach a token — used for login
// and (via rexCall) for authenticated calls once a token is resolved.
// AbortController-timed so a slow Rex can never block a page render.
async function rexPost(
  path: string,
  body: unknown,
  token?: string
): Promise<RexResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${base()}/v1/rex/${path}`, {
      method: "POST", // Rex only accepts POST
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  let data: { result?: unknown; error?: unknown } = {};
  try {
    data = (await res.json()) as { result?: unknown; error?: unknown };
  } catch {
    /* empty/non-JSON body */
  }
  const error =
    typeof data?.error === "string"
      ? data.error
      : data?.error
        ? JSON.stringify(data.error)
        : null;
  return { status: res.status, ok: res.ok && !error, result: data?.result, error };
}

// Log into the Rex account and return a fresh token. Login result may be a
// bare GUID string or { token } — accept either.
async function login(accountId: string | null): Promise<string> {
  const payload: Record<string, unknown> = {
    email: process.env.REX_API_EMAIL,
    password: process.env.REX_API_PASSWORD,
    token_lifetime: TOKEN_LIFETIME,
  };
  if (accountId) payload.account_id = accountId;
  const res = await rexPost("Authentication/login", payload);
  const token =
    typeof res.result === "string"
      ? res.result
      : ((res.result as { token?: string } | undefined)?.token ?? null);
  if (!res.ok || !token) {
    throw new Error(res.error ?? `Rex login failed (${res.status})`);
  }
  tokenCache.set(accountKey(accountId), {
    token,
    expiresAt: Date.now() + TOKEN_LIFETIME * 1000 - TOKEN_SKEW_MS,
  });
  return token;
}

async function getToken(accountId: string | null, force = false): Promise<string> {
  const key = accountKey(accountId);
  const cached = tokenCache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.token;
  return login(accountId);
}

// Authenticated call: resolve a token, POST, and retry ONCE with a fresh token
// if Rex rejects it (expired / invalidated between our cache and the request).
export async function rexCall(
  service: string,
  method: string,
  body?: unknown
): Promise<RexResponse> {
  if (!rexConfigured()) {
    throw new Error("Rex isn't connected yet (missing REX_API_EMAIL/PASSWORD).");
  }
  const accountId = rexAccountId();
  const path = `${service}/${method}`;
  let token = await getToken(accountId);
  let res = await rexPost(path, body, token);
  if (isTokenError(res)) {
    token = await getToken(accountId, true); // force re-login
    res = await rexPost(path, body, token);
  }
  return res;
}

// Rex results are either a bare array or { rows: [...] } — normalise to rows.
export function rexRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const rows = (result as { rows?: unknown[] } | null | undefined)?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

// Asks Rex itself what fields a model accepts (e.g. "Contacts", "Listings") —
// ground truth instead of guessing field names against the live account.
export async function rexDescribeModel(model: string): Promise<unknown> {
  const res = await rexCall(model, "describeModel", {});
  if (!res.ok) {
    throw new Error(res.error ?? `Rex describeModel(${model}) failed`);
  }
  return res.result;
}

// The users on the Rex account (id + name/email) — how the admin finds each
// agent's Rex user id to store against their portal profile. NOTE (carried
// from TEG): "AccountUsers" is the expected service name; if Rex rejects it,
// its error will name the valid one.
export async function rexListAccountUsers(): Promise<unknown> {
  const res = await rexCall("AccountUsers", "search", { limit: 100 });
  if (!res.ok) throw new Error(res.error ?? "Rex user list failed");
  return res.result;
}

// Every account user, paging past Rex's 100-row search cap.
async function rexAllAccountUsers(): Promise<Array<Record<string, unknown>>> {
  const all: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const res = await rexCall("AccountUsers", "search", { limit: 100, offset });
    if (!res.ok) break;
    const rows = rexRows(res.result);
    all.push(...rows);
    if (rows.length < 100) break;
  }
  return all;
}

// The lettings agents on the Rex account — everyone with a @thelettingexperts
// email (excluding shared inboxes). Their Rex user ids are what we sum the
// business-wide live stats over. Cached ~10 min.
let lettingsAgentsCache: { at: number; agents: Array<{ id: string; email: string }> } | null = null;
const LETTINGS_TTL_MS = 10 * 60 * 1000;

export async function rexLettingsAgents(): Promise<Array<{ id: string; email: string }>> {
  if (!rexConfigured()) return [];
  if (lettingsAgentsCache && Date.now() - lettingsAgentsCache.at < LETTINGS_TTL_MS) {
    return lettingsAgentsCache.agents;
  }
  const agents: Array<{ id: string; email: string }> = [];
  const seen = new Set<string>();
  try {
    for (const r of await rexAllAccountUsers()) {
      const email = String(r.email_address ?? r.email ?? "").trim().toLowerCase();
      const id = String(r.id ?? r.user_id ?? "");
      if (!id || seen.has(id)) continue;
      if (!email.endsWith("@thelettingexperts.co.uk")) continue;
      if (/^(info|support|no-?reply|admin|hello|accounts|hr)@/.test(email)) continue;
      seen.add(id);
      agents.push({ id, email });
    }
    lettingsAgentsCache = { at: Date.now(), agents };
  } catch {
    /* best-effort — return whatever we gathered (or the stale cache) */
    if (lettingsAgentsCache) return lettingsAgentsCache.agents;
  }
  return agents;
}

// Auto-match a portal agent to their Rex user by EMAIL — the natural key,
// since it's the same address they sign into Rex with. Best-effort: returns
// null (never throws). Cached per account+email; note it caches null misses
// too, so a server restart is needed after adding an agent to Rex.
const rexUserIdCache = new Map<string, string | null>();

export async function rexFindUserIdByEmail(email: string): Promise<string | null> {
  const needle = email.trim().toLowerCase();
  if (!needle) return null;
  const key = `${rexAccountId() ?? "default"}:${needle}`;
  const cached = rexUserIdCache.get(key);
  if (cached !== undefined) return cached;

  let found: string | null = null;
  try {
    const res = await rexCall("AccountUsers", "search", { limit: 100 });
    if (res.ok) {
      for (const raw of rexRows(res.result)) {
        const rowEmail = String(raw.email_address ?? raw.email ?? "")
          .trim()
          .toLowerCase();
        if (rowEmail && rowEmail === needle) {
          const id = raw.id ?? raw.user_id;
          if (id != null) found = String(id);
          break;
        }
      }
    }
  } catch {
    /* best-effort — callers fall back rather than failing */
  }
  rexUserIdCache.set(key, found);
  return found;
}

// Proves the login works and reports the accounts this user can reach — the
// returned list is how you find REX_ACCOUNT_ID in the first place, no digging
// through the Rex UI needed (getAccessibleAccounts works without account_id).
export async function rexPing(): Promise<{
  configured: boolean;
  ok: boolean;
  accounts?: Array<{ id: string; name: string | null }>;
  error?: string;
}> {
  if (!rexConfigured()) return { configured: false, ok: false };
  try {
    const res = await rexCall("UserProfile", "getAccessibleAccounts", {});
    if (!res.ok) return { configured: true, ok: false, error: res.error ?? "failed" };
    const raw = Array.isArray(res.result) ? res.result : [];
    const accounts = raw.map((a) => {
      const row = a as Record<string, unknown>;
      const id = row.id ?? row.account_id ?? row.value;
      const name =
        (row.name as string) ??
        (row.account_name as string) ??
        (row.title as string) ??
        (row.label as string) ??
        null;
      return { id: String(id), name };
    });
    return { configured: true, ok: true, accounts };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      error: e instanceof Error ? e.message : "Rex unreachable",
    };
  }
}
