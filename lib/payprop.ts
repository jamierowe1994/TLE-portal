import "server-only";

// PayProp Agency API v1.1 client — the system of record for managed properties,
// rent and tenant balances. Read-only: this client never writes.
//
// Notes from the spec (api_spec.yaml, uk.payprop.com):
//   • Base: https://uk.payprop.com/api/agency/v1.1
//   • Auth is NOT Bearer — PayProp uses its own scheme:
//        Authorization: APIkey <key>
//   • List endpoints page with ?rows=&page=.
//
// Two behaviours worth knowing, both found by probing the live API (they are not
// in the published spec, and each silently loses data if you miss it):
//   1. `rows` is CAPPED AT 25. Ask for 100 and you get 25 back with no error —
//      so you must page off `pagination.total_pages`, never off "did I get a
//      short page?".
//   2. Envelopes differ: export/* return { items }, report/* return their own
//      key (e.g. report/tenant/balances → { balances }).
//
// Every call is best-effort: a miss, an outage or a missing key returns null /
// [] rather than throwing, so the dashboard degrades instead of breaking —
// same contract as lib/rex.ts.

const DEFAULT_BASE = "https://uk.payprop.com/api/agency/v1.1";
const PAGE_ROWS = 25; // PayProp's hard cap — larger values are silently clamped
const MAX_PAGES = 200; // hard stop (5k rows) so a bad total_pages can't spin
const TIMEOUT_MS = 12_000;

function base(): string {
  return (process.env.PAYPROP_API_BASE ?? DEFAULT_BASE).replace(/\/$/, "");
}

/** The owner has added a PayProp API key. */
export function payPropConfigured(): boolean {
  return !!process.env.PAYPROP_API_KEY;
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
 * One authenticated GET. Returns null on any failure (never throws) so callers
 * can fall back to the snapshot rather than blowing up a page.
 */
export async function payPropGet<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<PayPropPage<T> | null> {
  if (!payPropConfigured()) return null;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const url = `${base()}/${path.replace(/^\//, "")}${qs.size ? `?${qs}` : ""}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        // PayProp's own scheme — "APIkey", not "Bearer".
        Authorization: `APIkey ${process.env.PAYPROP_API_KEY}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    if (Array.isArray(json)) return { items: json as T[] };
    const obj = json as Record<string, unknown>;
    const pagination = obj.pagination as PayPropPagination | undefined;
    // export/* use `items`; report/* name their own array (e.g. `balances`).
    // Fall back to the first array on the object so a new report still works.
    let rows = obj.items ?? obj.balances;
    if (!Array.isArray(rows)) rows = Object.values(obj).find((v) => Array.isArray(v));
    return { items: (Array.isArray(rows) ? rows : []) as T[], pagination };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Page through a list endpoint and return every row.
 *
 * Pages off `total_pages` rather than "was that a short page?" — PayProp clamps
 * `rows` to 25, so a short-page check would stop after the first page and
 * silently return a fraction of the data.
 */
export async function payPropGetAll<T = Record<string, unknown>>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await payPropGet<T>(path, { ...params, rows: PAGE_ROWS, page });
    if (!res) break; // failed mid-way — return what we have
    all.push(...res.items);
    const totalPages = res.pagination?.total_pages;
    if (totalPages != null) {
      if (page >= totalPages) break;
    } else if (res.items.length < PAGE_ROWS) {
      break; // no pagination block to trust — fall back to the short page
    }
  }
  return all;
}

/** Connection check — does the key work, and what can it see? */
export async function payPropPing(): Promise<{
  configured: boolean;
  ok: boolean;
  properties?: number;
  error?: string;
}> {
  if (!payPropConfigured()) return { configured: false, ok: false };
  const res = await payPropGet("export/properties", { rows: 1, page: 1 });
  if (!res) {
    return {
      configured: true,
      ok: false,
      error: "PayProp rejected the key or couldn't be reached.",
    };
  }
  return {
    configured: true,
    ok: true,
    properties: res.pagination?.total_rows ?? res.items.length,
  };
}
