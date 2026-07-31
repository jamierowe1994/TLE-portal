import "server-only";

// PayProp Agency API v1.1 client — the system of record for managed properties,
// rent, commission and tenant balances. Read-only: this client never writes.
//
// TWO ACCOUNTS. The business runs Scotland and the rest of the UK as separate
// PayProp agencies, each with its own API key. Neither can see the other, so
// every business-wide figure is the SUM across both. (This is why the portal's
// REX-derived "managed" read low and the snapshot noted Glasgow was missing —
// Scotland was simply a different account nobody had connected.)
//
// Notes from the spec (uk.payprop.com):
//   • Base: https://uk.payprop.com/api/agency/v1.1
//   • Two auth schemes are supported, OAuth first:
//       - OAuth2 client credentials → Authorization: Bearer <token>
//         (PAYPROP_CLIENT_ID[_ACCOUNT] + PAYPROP_CLIENT_SECRET[_ACCOUNT])
//       - PayProp's original scheme  → Authorization: APIkey <key>
//     An account uses OAuth when it has a client id/secret, and falls back to
//     its API key otherwise, so the two accounts can migrate independently.
//
// Three behaviours found by probing the live API — none are in the published
// spec, and each silently loses data if you miss it:
//   1. `rows` is CAPPED AT 25. Ask for 100 and you get 25 back with no error, so
//      you must page off `pagination.total_pages`, never off "was that a short
//      page?".
//   2. `is_archived` defaults to false — the export quietly omits archived
//      properties (103 of them on the Scotland account alone).
//   3. Envelopes differ: export/* return { items }, report/* return their own
//      key (report/tenant/balances → { balances }).
//
// Every call is best-effort: a miss, an outage or a missing key returns null /
// [] rather than throwing, so the dashboard degrades instead of breaking —
// same contract as lib/rex.ts.

const DEFAULT_BASE = "https://uk.payprop.com/api/agency/v1.1";
const PAGE_ROWS = 25; // PayProp's hard cap — larger values are silently clamped
const MAX_PAGES = 200; // hard stop (5k rows) so a bad total_pages can't spin
// export/properties with tenancy and contract includes is the slowest call
// we make; 12s was tight enough to look like a failed page under load.
const TIMEOUT_MS = 25_000;

export type PayPropAccountId = "scotland" | "uk";

interface AccountDef {
  id: PayPropAccountId;
  label: string;
  /** Env vars tried in order — the first non-empty one wins. */
  envKeys: string[];
  /** OAuth2 client credentials, same first-match-wins rule. */
  clientIdKeys: string[];
  clientSecretKeys: string[];
}

const ACCOUNTS: AccountDef[] = [
  // PAYPROP_API_KEY is the original single-account name, kept as a fallback so a
  // half-finished rename can't take Scotland offline.
  {
    id: "scotland",
    label: "Scotland",
    envKeys: ["PAYPROP_API_KEY_SCOTLAND", "PAYPROP_API_KEY"],
    clientIdKeys: ["PAYPROP_CLIENT_ID_SCOTLAND", "PAYPROP_CLIENT_ID"],
    clientSecretKeys: ["PAYPROP_CLIENT_SECRET_SCOTLAND", "PAYPROP_CLIENT_SECRET"],
  },
  {
    id: "uk",
    label: "Rest of UK",
    envKeys: ["PAYPROP_API_KEY_UK"],
    clientIdKeys: ["PAYPROP_CLIENT_ID_UK", "PAYPROP_CLIENT_ID"],
    clientSecretKeys: ["PAYPROP_CLIENT_SECRET_UK", "PAYPROP_CLIENT_SECRET"],
  },
];

function base(): string {
  return (process.env.PAYPROP_API_BASE ?? DEFAULT_BASE).replace(/\/$/, "");
}

function firstEnv(names: string[]): string | null {
  for (const name of names) {
    const v = process.env[name];
    if (v) return v;
  }
  return null;
}

function keyFor(id: PayPropAccountId): string | null {
  const def = ACCOUNTS.find((a) => a.id === id);
  return def ? firstEnv(def.envKeys) : null;
}

function oauthFor(id: PayPropAccountId): { id: string; secret: string } | null {
  const def = ACCOUNTS.find((a) => a.id === id);
  if (!def) return null;
  const clientId = firstEnv(def.clientIdKeys);
  const secret = firstEnv(def.clientSecretKeys);
  return clientId && secret ? { id: clientId, secret } : null;
}

/* ------------------------------ OAuth tokens ------------------------------ */

/** Host root + /api/oauth/... — the OAuth endpoints sit outside the versioned base. */
function oauthRoot(): string {
  const b = base();
  const host = b.replace(/\/api\/agency\/v[\d.]+$/, "");
  return `${host}/api/oauth`;
}

export function payPropAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const u = new URL(`${oauthRoot()}/authorize`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", params.clientId);
  u.searchParams.set("redirect_uri", params.redirectUri);
  u.searchParams.set("state", params.state);
  if (params.scope) u.searchParams.set("scope", params.scope);
  return u.toString();
}

function tokenUrl(): string {
  return process.env.PAYPROP_TOKEN_URL ?? `${oauthRoot()}/access_token`;
}

/** The client credentials for an account — used by the connect/callback routes. */
export function payPropClient(account: PayPropAccountId) {
  return oauthFor(account);
}

const tokens = new Map<PayPropAccountId, { token: string; expiresAt: number }>();
const pending = new Map<PayPropAccountId, Promise<string | null>>();

async function fetchToken(account: PayPropAccountId): Promise<string | null> {
  const creds = oauthFor(account);
  if (!creds) return null;

  // PayProp only issues tokens through the authorisation-code grant, so this
  // needs the refresh token saved when someone connected the account. Their
  // spec says refresh tokens never expire, but each refresh returns a new one,
  // so we store whatever comes back.
  const { getPayPropTokens, updatePayPropRefreshToken, savePayPropTokens } =
    await import("@/lib/payprop-tokens");
  const stored = await getPayPropTokens(account);

  // A refresh token can also be seeded from the environment. That matters for
  // production: consent has to happen somewhere PayProp will redirect to, and
  // until our live callback is registered the only completed consent lives on
  // a developer machine. The token itself is portable, so lifting it into
  // Railway gets production running without waiting.
  //
  // NOTE: PayProp issues a NEW refresh token on every refresh, so two
  // environments must not share one — whichever refreshes first leaves the
  // other holding a stale token. Seed one environment, not both.
  const seeded =
    process.env[`PAYPROP_REFRESH_TOKEN_${account.toUpperCase()}`] ??
    process.env.PAYPROP_REFRESH_TOKEN;
  const refreshToken = stored?.refreshToken ?? seeded;
  if (!refreshToken) return null;

  try {
    const res = await fetch(tokenUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: creds.id,
        client_secret: creds.secret,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };
    if (!data.access_token) return null;
    // Persist the rotated token. If we started from the env seed there's no
    // record yet, so write a full one — after this the volume is the source of
    // truth and the seed is only a fallback.
    if (data.refresh_token && data.refresh_token !== refreshToken) {
      if (stored) {
        await updatePayPropRefreshToken(account, data.refresh_token).catch(() => {});
      } else {
        await savePayPropTokens(account, {
          refreshToken: data.refresh_token,
          connectedBy: "seeded from environment",
          connectedAt: new Date().toISOString(),
        }).catch(() => {});
      }
    }
    // Retire it a minute early so no call starts with a token about to die.
    const ttl = Math.max((data.expires_in ?? 3600) * 1000 - 60_000, 30_000);
    tokens.set(account, { token: data.access_token, expiresAt: Date.now() + ttl });
    return data.access_token;
  } catch {
    return null;
  }
}

async function accessToken(account: PayPropAccountId): Promise<string | null> {
  const held = tokens.get(account);
  if (held && Date.now() < held.expiresAt) return held.token;
  // Collapse concurrent renders onto a single token request per account.
  let job = pending.get(account);
  if (!job) {
    job = fetchToken(account).finally(() => pending.delete(account));
    pending.set(account, job);
  }
  return job;
}

/** OAuth when the account has client credentials, its API key otherwise. */
async function authHeader(account: PayPropAccountId): Promise<string | null> {
  if (oauthFor(account)) {
    const t = await accessToken(account);
    if (t) return `Bearer ${t}`;
    // Fall through: a token failure shouldn't take the account offline if it
    // still has a working API key.
  }
  const key = keyFor(account);
  return key ? `APIkey ${key}` : null;
}

export function payPropLabel(id: PayPropAccountId): string {
  return ACCOUNTS.find((a) => a.id === id)?.label ?? id;
}

/** Accounts we actually hold a key for. Business-wide figures sum over these. */
export function payPropAccounts(): PayPropAccountId[] {
  return ACCOUNTS.filter((a) => keyFor(a.id) || oauthFor(a.id)).map((a) => a.id);
}

/** Which scheme an account will use — for the admin probe. */
export function payPropAuthMode(id: PayPropAccountId): "oauth" | "apikey" | null {
  if (oauthFor(id)) return "oauth";
  return keyFor(id) ? "apikey" : null;
}

/** True when at least one PayProp account is wired up. */
export function payPropConfigured(): boolean {
  return payPropAccounts().length > 0;
}

/* --------------------------- request throttling --------------------------- */

// PayProp rate-limits hard: three concurrent requests are fine, sustained
// parallelism starts returning 429s. Several background walks now run at once
// (payments, balances, invoices, properties), and between them they were
// tripping the limiter and losing whole pages — which surfaces as a plausible
// but wrong figure rather than an error. Everything therefore goes through one
// queue: a single request in flight at a time, with a small gap between.
// PayProp allows 5 requests a second, and exceeding it fails EVERY subsequent
// request for the next 30 seconds (spec §8.2). At 120ms we were sending 8.3/s,
// buying repeated 30-second lockouts and then waiting out our own retry
// backoff on top — a month's walk took three minutes. Going slower per request
// is dramatically faster overall.
const MIN_GAP_MS = 210;
let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await job();
    } finally {
      lastAt = Date.now();
    }
  });
  // Keep the chain alive even when a job rejects.
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run as Promise<T>;
}

export interface PayPropPagination {
  page?: number;
  rows?: number;
  total_pages?: number;
  total_rows?: number;
}

export interface PayPropPage<T> {
  items: T[];
  pagination?: PayPropPagination;
}

/**
 * One authenticated GET against a single account. Returns null on any failure
 * (never throws) so callers can fall back rather than blow up a page.
 */
export async function payPropGet<T = Record<string, unknown>>(
  account: PayPropAccountId,
  path: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<PayPropPage<T> | null> {
  const auth = await authHeader(account);
  if (!auth) return null;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const url = `${base()}/${path.replace(/^\//, "")}${qs.size ? `?${qs}` : ""}`;

  return enqueue(async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: auth, Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    // A rejected token is usually one revoked early — drop it so the next
    // call re-authenticates instead of repeating the failure.
    if (res.status === 401) tokens.delete(account);
    // Throttled: wait out the limiter and let the caller retry, rather than
    // returning null and having the page silently drop.
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 2;
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10) * 1000));
      return null;
    }
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    if (Array.isArray(json)) return { items: json as T[] };
    const obj = json as Record<string, unknown>;
    const pagination = obj.pagination as PayPropPagination | undefined;
    // export/* use `items`; report/* name their own array (e.g. `balances`).
    // Fall back to the first array present so a new report still works.
    let rows = obj.items ?? obj.balances;
    if (!Array.isArray(rows)) rows = Object.values(obj).find((v) => Array.isArray(v));
    return { items: (Array.isArray(rows) ? rows : []) as T[], pagination };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  });
}

/**
 * Every row from one account. Pages off `total_pages` rather than "was that a
 * short page?" — PayProp clamps `rows` to 25, so a short-page check would stop
 * after page one and silently return a fraction of the data.
 */
export async function payPropGetAll<T = Record<string, unknown>>(
  account: PayPropAccountId,
  path: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<T[]> {
  // Sequential on purpose. PayProp rate-limits: three concurrent requests are
  // fine, but sustained parallel batches start returning 429 and pages get
  // dropped — silent data loss, which is exactly what the caller can't detect.
  // The cost is paid once and cached by the callers (see payprop-income.ts).
  // No credentials for this account at all — nothing to walk, and not an error.
  if (!(await authHeader(account))) return [];

  const all: T[] = [];
  let expected: number | null = null;
  let short = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    let res = await payPropGet<T>(account, path, { ...params, rows: PAGE_ROWS, page });
    // Retry a few times with growing pauses — a dropped page is invisible
    // data loss, so it's worth being patient before giving up on one.
    for (let attempt = 1; !res && attempt <= 4; attempt++) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
      res = await payPropGet<T>(account, path, { ...params, rows: PAGE_ROWS, page });
    }
    if (!res) {
      short = true;
      break;
    }
    all.push(...res.items);
    if (expected == null) expected = res.pagination?.total_rows ?? null;

    const totalPages = res.pagination?.total_pages;
    if (totalPages != null) {
      if (page >= totalPages) break;
    } else if (res.items.length < PAGE_ROWS) {
      break; // no pagination block to trust — fall back to the short page
    }
  }

  // A page we genuinely failed to fetch means the result is incomplete, and a
  // partial walk is worse than none: it renders as a smaller but entirely
  // plausible number nobody can tell is wrong. Throw so the caller caches
  // nothing and retries.
  if (short) {
    throw new Error(
      `[payprop] ${path}: a page could not be fetched after retries — refusing to report a partial figure.`
    );
  }

  // A count below total_rows is NOT proof of loss: on a filtered query
  // (is_archived=false) PayProp reports the unfiltered total, so a correct
  // 481-row walk looks short against 630 and would throw forever — which is
  // exactly what left the Portfolio tab stuck on "fetching". Worth noting,
  // not worth discarding the data for.
  if (expected != null && all.length < expected) {
    console.warn(
      `[payprop] ${path}: ${all.length} rows against total_rows ${expected} — expected when filtering.`
    );
  }
  return all;
}

/** Fallback for endpoints that don't report total_pages — walk until short. */
async function sequentialRest<T>(
  account: PayPropAccountId,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  firstPage: T[]
): Promise<T[]> {
  const all = [...firstPage];
  for (let page = 2; page <= MAX_PAGES; page++) {
    const res = await payPropGet<T>(account, path, { ...params, rows: PAGE_ROWS, page });
    if (!res) break;
    all.push(...res.items);
    if (res.items.length < PAGE_ROWS) break;
  }
  return all;
}

/**
 * Every row across EVERY configured account, tagged with which one it came from.
 * This is the business-wide accessor — Scotland + rest of UK together.
 */
export async function payPropGetAllAccounts<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<Array<T & { _account: PayPropAccountId }>> {
  const ids = payPropAccounts();
  const pages = await Promise.all(
    ids.map(async (id) =>
      (await payPropGetAll<T>(id, path, params)).map((row) => ({ ...row, _account: id }))
    )
  );
  return pages.flat();
}

/** Connection check per account — does each key work, and what can it see? */
export async function payPropPing(): Promise<
  Array<{
    account: PayPropAccountId;
    label: string;
    configured: boolean;
    ok: boolean;
    properties?: number;
    error?: string;
  }>
> {
  return Promise.all(
    ACCOUNTS.map(async (a) => {
      // Configured means "has some way to authenticate" — OAuth or a key.
      if (!keyFor(a.id) && !oauthFor(a.id)) {
        return { account: a.id, label: a.label, configured: false, ok: false };
      }
      const res = await payPropGet(a.id, "export/properties", { rows: 1, page: 1 });
      if (!res) {
        return {
          account: a.id,
          label: a.label,
          configured: true,
          ok: false,
          error: "PayProp rejected the credentials, or the account isn't connected yet.",
        };
      }
      return {
        account: a.id,
        label: a.label,
        configured: true,
        ok: true,
        properties: res.pagination?.total_rows ?? res.items.length,
      };
    })
  );
}
