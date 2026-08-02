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
// Hard stop so a bad total_pages can't spin: 200 pages × 25 rows = 5,000 rows.
//
// THAT CEILING IS PER ACCOUNT, NOT PER RANGE. This bounds the loop in
// payPropGetAll, which walks ONE account; the business-wide callers fan out
// over payPropAccounts() and walk each separately (paymentsForRange does this),
// so a business-wide range gets 5,000 rows per agency — 10,000 across Scotland
// and the rest of the UK. Reading it as one 5,000-row budget for the range is
// wrong, and the arithmetic that used to sit here ("~291 pages, so year-to-date
// reports about 69% of itself") was that misreading.
//
// KNOWN DEFECT, not fixed here: a walk that needs more than MAX_PAGES pages
// exits on this condition with `short` still false, so it returns a partial
// figure and says nothing. Whether it currently bites depends on the split
// between the two agencies, which nobody has measured. At the 1,039
// payments/month verified in payprop-income.ts a year-to-date range is ~9k rows
// business-wide — inside the combined 10,000, but one agency truncates the
// moment it carries more than 5,000 of them, i.e. more than ~56% of the total.
// A 56/44 split is entirely ordinary, so treat this as unknown rather than
// safe. The right fix is to treat "hit the ceiling while total_pages says there
// is more" as a dropped page and throw, which is a deliberate behaviour change:
// the YTD tile would go amber rather than quietly wrong, and it wants landing
// with the walk-once-and-slice work rather than on its own.
const MAX_PAGES = 200;
// export/properties with tenancy and contract includes is the slowest call
// we make; 12s was tight enough to look like a failed page under load.
const TIMEOUT_MS = 25_000;
/** Genuine failures we'll re-try one page through, before giving up on it. */
const PAGE_RETRIES = 4;
/** Ceiling on total patience per page. Waiting out a rate-limiter is worth it;
 *  waiting out a dead endpoint is a hang, and it holds a queue slot while it
 *  does. Bounds the retry loop no matter how often the gate re-arms. */
const PAGE_RETRY_BUDGET_MS = 90_000;

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

// PayProp rate-limits hard: several background walks now run at once
// (payments, balances, invoices, properties), and between them they were
// tripping the limiter and losing whole pages — which surfaces as a plausible
// but wrong figure rather than an error. Everything therefore goes through one
// queue.
//
// PayProp allows 5 requests a second, and exceeding it fails EVERY subsequent
// request for the next 30 seconds (spec §8.2). At 120ms we were sending 8.3/s,
// buying repeated 30-second lockouts and then waiting out our own retry
// backoff on top — a month's walk took three minutes.
//
// WHY A RESERVED START TIME RATHER THAN A GAP AFTER THE RESPONSE. The previous
// queue slept `MIN_GAP_MS` and then stamped the clock in a `finally` once the
// response had landed, so the real period was the gap PLUS the request's own
// latency — 210ms of configured gap ran at 1.2–2.2 req/s depending on how
// PayProp felt that minute. A request now reserves its start slot BEFORE it
// sleeps, so spacing is measured request-to-request and the configured rate
// means what it says regardless of latency.
//
// WHY THIS RATE. 2.5/s is half the documented allowance. The only empirical
// points this project has are "8.3/s trips the limiter" (a lockout loop that
// turned a month's walk into three minutes) and "~1.2–2.2/s does not"
// (production for months); nothing in between has ever been observed. 2.5/s
// sits just above the known-good end of that gap rather than in the middle of
// it, because the penalty for guessing high is not a slow page — it is a
// 30-second blackout that discards a 50-page walk. Raise PAYPROP_RPS towards 3
// after a clean week if the walks are still the bottleneck; it is env-read so
// an incident can be dialled back without a deploy.
//
// WHY CONCURRENCY 2 AND NOT 1. Concurrency is NOT a rate control here — pacing
// is, and it is enforced whatever the slot count. One slot cannot sustain the
// configured rate at all: the next request cannot start until the previous one
// returns, so a 400ms period behind a 500ms response degrades to 2/s. Two slots
// sustain 2.5/s up to ~800ms latency, and mean one page stuck on the 25s
// timeout no longer stalls every other caller behind it. Above the sustaining
// point the queue simply runs slower than configured, which is the safe
// direction to fail. Capped at 3, which is the most this file has ever recorded
// as observed-fine against PayProp; going beyond that is a deliberate decision
// somebody should have to make in code, not in an env var.
//
// CONSTRAINT WORTH KNOWING: this gate is per-process module state. Two Railway
// instances means twice the rate against one PayProp allowance. If this is ever
// scaled out horizontally, set PAYPROP_RPS to (allowance / instances) or move
// the gate into Postgres.
//
// WHY PAYPROP_RPS IS CAPPED WELL BELOW THE ALLOWANCE. Spacing is exact in the
// arithmetic and not on the wire: a timer that fires a few milliseconds late
// pulls one start closer to the next, so the worst one-second window holds
// floor(1000 / period) + 1 requests, not floor(1000 / period). Simulating this
// scheduler bore that out — at a 200ms period (5/s) SIX starts landed inside
// one second, and at 250ms (4/s) five did, which is the allowance exactly.
// 3.5/s is therefore the highest we let anyone configure (worst window 4 of 5),
// and the 2.5/s default holds a worst window of 3.
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const RPS = Math.min(num(process.env.PAYPROP_RPS, 2.5), 3.5);
const PERIOD_MS = Math.max(Math.ceil(1000 / RPS), 100);
const MAX_CONCURRENT = Math.min(
  Math.max(Math.floor(num(process.env.PAYPROP_MAX_CONCURRENT, 2)), 1),
  3
);
/** Longest we will ever honour a lockout for — a hostile or absurd
 *  Retry-After must not be able to wedge the queue for hours. */
const MAX_LOCKOUT_MS = 60_000;
/** What to assume when a 429 arrives with no usable Retry-After: the
 *  documented penalty, not the 2 seconds this used to guess. */
const DEFAULT_LOCKOUT_MS = 30_000;
/** After a 429, run at half rate for this long before recovering — one AIMD
 *  step, so a partial lockout can't settle into a loop. */
const SLOW_WINDOW_MS = 60_000;
/** Backstop on any single sleep. Nothing should ever reach it (a reservation
 *  is at most one lockout plus MAX_CONCURRENT periods ahead); it exists so a
 *  clock jump can't park a request forever. */
const MAX_SLEEP_MS = 90_000;
/** The old chain was unbounded. Beyond this, callers get null and degrade —
 *  which they all already handle — rather than the process growing a queue it
 *  can never drain. */
const MAX_WAITERS = 2_000;

/** Earliest wall-clock time the next request may be ISSUED. */
let nextStart = 0;
/** Shared 429 gate. Every caller respects it, so a lockout is waited out once
 *  rather than once per in-flight request. */
let lockedUntil = 0;
/** Halve the rate until this time — set on any 429. */
let slowUntil = 0;
let inFlight = 0;
const waiting: Array<() => void> = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, MAX_SLEEP_MS)));

function pump(): void {
  while (inFlight < MAX_CONCURRENT && waiting.length > 0) {
    const go = waiting.shift();
    if (!go) break;
    // Count the slot here, not in the woken continuation: the continuation is
    // a microtask, and until it runs this loop would otherwise hand the same
    // slot to everybody left in the queue.
    inFlight++;
    go();
  }
}

/**
 * Claim the next issue slot. Pure arithmetic — deliberately nothing here can
 * throw, because a pacing bug must never take the integration offline.
 *
 * Reservations are naturally bounded: one is only ever taken while holding a
 * concurrency slot, so at most MAX_CONCURRENT are outstanding and `nextStart`
 * cannot run away into next week however long the queue behind it is.
 */
function reserve(): number {
  const now = Date.now();
  const period = now < slowUntil ? PERIOD_MS * 2 : PERIOD_MS;
  const start = Math.max(now, nextStart, lockedUntil);
  nextStart = start + period;
  return start;
}

/** Hold every caller off until the limiter has cleared. */
function lockOut(ms: number): void {
  const until = Date.now() + Math.min(Math.max(ms, 1_000), MAX_LOCKOUT_MS);
  if (until > lockedUntil) lockedUntil = until;
  // Slots already reserved would otherwise fire straight into the live
  // lockout — the gate has to move the cursor as well as the floor.
  if (lockedUntil > nextStart) nextStart = lockedUntil;
  slowUntil = Date.now() + SLOW_WINDOW_MS;
}

/** True while the shared 429 gate is holding. Used by the paging retry loop:
 *  a lockout is a wait, not a failed page, and shouldn't spend a retry. */
function lockedOut(): boolean {
  return Date.now() < lockedUntil;
}

/** Retry-After as milliseconds. Integer seconds and HTTP-dates are both legal;
 *  anything else (absent, empty, malformed) falls back to the documented
 *  30-second penalty rather than optimistically guessing small. */
function retryAfterMs(header: string | null): number {
  if (header) {
    const secs = Number(header.trim());
    if (Number.isFinite(secs) && secs > 0) return secs * 1000;
    const at = Date.parse(header);
    if (Number.isFinite(at) && at - Date.now() > 0) return at - Date.now();
  }
  return DEFAULT_LOCKOUT_MS;
}

async function enqueue<T>(job: () => Promise<T>): Promise<T | null> {
  if (waiting.length >= MAX_WAITERS) return null;
  await new Promise<void>((resolve) => {
    waiting.push(resolve);
    pump();
  });
  // A slot is held from here. EVERY path out of this block must go through the
  // finally: a leaked slot doesn't fail loudly, it deadlocks the whole
  // integration until the process restarts, with every PayProp figure quietly
  // going blank at once.
  try {
    const start = reserve();
    const wait = start - Date.now();
    if (wait > 0) await sleep(wait);
    // reserve() is the only place the 429 gate is consulted, and it ran before
    // that sleep — up to ~800ms ago. A lockout armed in between would otherwise
    // find this request already holding its slot and let it fire straight into
    // the live blackout, taking a second 429 that re-bases `lockedUntil` and
    // extends a nominally 30-second lockout past it. Observed: a caller issuing
    // 29,660ms into one.
    //
    // A LOOP, NOT ONE CHECK, because the wait itself is another such window.
    // MAX_CONCURRENT requests go out ~PERIOD_MS apart, so their 429s land
    // seconds apart: the first arms the gate, we sleep to it, the second
    // re-bases `lockedUntil` while we sleep, and a single check would wake us
    // into precisely the live blackout it was added to prevent. Re-read after
    // every sleep and only issue once the gate is genuinely clear.
    //
    // This terminates. lockOut() is the only writer of `lockedUntil` and clamps
    // each arming to MAX_LOCKOUT_MS ahead of the instant it fires; it is only
    // ever called by a request that already holds a slot and is past this gate.
    // Anything still queued is floored to `lockedUntil` by reserve() and then
    // held here, so it never issues and never 429s. Only requests already in
    // flight when the gate armed can re-base it, and there are at most
    // MAX_CONCURRENT of those. The iteration cap turns that argument into a
    // hard bound, and stops a backwards clock jump parking this slot the way
    // MAX_SLEEP_MS stops it parking a single sleep.
    for (let i = 0; i <= MAX_CONCURRENT && Date.now() < lockedUntil; i++) {
      await sleep(lockedUntil - Date.now());
    }
    return await job();
  } finally {
    inFlight--;
    pump();
  }
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
/**
 * A raw GET that reports what actually happened.
 *
 * payPropGet collapses 404, 403, a rate-limit lockout and a genuinely empty
 * result all to `null`, which is right for production — every caller wants
 * "no data, carry on" — and useless for finding out which endpoints exist.
 * This exists for the admin probes and nothing else.
 *
 * It goes through the SAME rate-limit gate as everything else. A probe that
 * bypassed the throttle would trip the 429 lockout that live dashboards share,
 * so a diagnostic would take the real figures down with it.
 */
export interface PayPropRawResponse {
  status: number;
  ok: boolean;
  json: unknown;
  /** Non-JSON bodies (HTML error pages), truncated. */
  text: string | null;
  error: string | null;
}

export async function payPropRaw(
  account: PayPropAccountId,
  path: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<PayPropRawResponse> {
  const auth = await authHeader(account);
  if (!auth) {
    return { status: 0, ok: false, json: null, text: null, error: "no credentials" };
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const url = `${base()}/${path.replace(/^\//, "")}${qs.size ? `?${qs}` : ""}`;

  const out = await enqueue(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Authorization: auth, Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (res.status === 401) tokens.delete(account);
      if (res.status === 429) lockOut(retryAfterMs(res.headers.get("retry-after")));
      const body = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(body);
      } catch {
        /* not JSON — keep the text instead */
      }
      return {
        status: res.status,
        ok: res.ok,
        json,
        text: json == null ? body.slice(0, 400) : null,
        error: res.ok ? null : `HTTP ${res.status}`,
      };
    } catch (e) {
      return {
        status: 0,
        ok: false,
        json: null,
        text: null,
        error: e instanceof Error ? e.message : "request failed",
      };
    } finally {
      clearTimeout(timer);
    }
  });
  return (
    out ?? { status: 0, ok: false, json: null, text: null, error: "queue full or throttled" }
  );
}

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
    // Throttled. Don't sleep here — record the lockout on the shared gate and
    // return. Sleeping in place was only correct while exactly one request
    // could exist: with a second slot, two 429s would each sleep their own
    // countdown and then fire together the moment they woke, straight back
    // into the limiter. The gate holds every caller through two separate
    // checks: reserve() puts still-queued requests behind `lockedUntil`, and
    // enqueue() re-reads it after every pre-issue sleep until it is clear,
    // which is what catches a request that reserved its slot before the gate
    // was armed — including one the second 429 re-bases mid-wait.
    if (res.status === 429) {
      lockOut(retryAfterMs(res.headers.get("retry-after")));
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
  // Sequential because each page needs the previous page's `total_pages` to
  // know whether there is another one — not as rate control, which the shared
  // queue in this file now owns outright. The cost is paid once and cached by
  // the callers (see payprop-income.ts).
  // No credentials for this account at all — nothing to walk, and not an error.
  if (!(await authHeader(account))) return [];

  const all: T[] = [];
  let expected: number | null = null;
  let short = false;

  for (let page = 1; page <= MAX_PAGES; page++) {
    let res = await payPropGet<T>(account, path, { ...params, rows: PAGE_ROWS, page });
    // Retry a few times with growing pauses — a dropped page is invisible
    // data loss, so it's worth being patient before giving up on one.
    //
    // A 429 must NOT spend a retry. The old budget was 500+1000+1500+2000ms of
    // backoff plus a 2s in-slot sleep per attempt: 15 seconds against a
    // documented 30-second lockout, so every attempt landed inside the lockout,
    // the walk threw, and the caller restarted it from page 1 — discarding the
    // fifty pages already in hand and walking straight back into the limiter.
    // That is the loop that turned a month's walk into three minutes. Now the
    // shared gate does the waiting and only genuine failures cost an attempt.
    if (!res) {
      const deadline = Date.now() + PAGE_RETRY_BUDGET_MS;
      let attempt = 0;
      while (!res && Date.now() < deadline) {
        if (lockedOut()) {
          // Wait the limiter out; it doesn't cost an attempt. Always sleep at
          // least a beat, because not every null comes back from the queue —
          // a missing token or a full queue returns immediately, and without
          // the floor those would spin here for the whole budget.
          await sleep(Math.max(lockedUntil - Date.now(), 250));
        } else {
          if (++attempt > PAGE_RETRIES) break;
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 8_000));
        }
        res = await payPropGet<T>(account, path, { ...params, rows: PAGE_ROWS, page });
      }
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
