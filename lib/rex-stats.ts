import "server-only";
import type { FunnelStats } from "./types";
import { rexCall, rexConfigured, rexRows } from "./rex";

// Best-effort per-agent funnel stats from REX — NEW for the TLE portal.
//
// TEG never read stats out of Rex (it only pushed leads in), so none of the
// reporting endpoints here are confirmed against the live account. This module
// therefore works by CAPABILITY DISCOVERY: on first use it probes what the
// account actually answers (login, AccountUsers/search, Leads/search with a
// date-range criteria, describeModel on plausible reporting services) and
// records a boolean per capability for the admin diagnostics panel.
//
// ABSOLUTE RULES (contract with every caller):
//   • never throw — any failure returns null so callers fall back to the
//     Base44 snapshot via resolveStat();
//   • never block a page: every underlying rexCall is AbortController-timed
//     (8s, in lib/rex.ts) AND getAgentFunnel races an overall 8s deadline;
//   • return ONLY stats we could truly compute — everything else stays
//     undefined in the Partial<FunnelStats>.

const CAPS_TTL_MS = 10 * 60 * 1000; // re-probe capabilities every ~10 min
const OVERALL_DEADLINE_MS = 8_000;

export interface RexStatus {
  ok: boolean;
  reason?: string; // "not-configured" when env creds are missing
  capabilities: Record<string, boolean>;
  lastError?: string;
  checkedAt?: string; // ISO — when the capability probe last ran
}

interface CapsCache {
  checkedAt: number;
  capabilities: Record<string, boolean>;
  lastError?: string;
}

let capsCache: CapsCache | null = null;
let capsInFlight: Promise<CapsCache> | null = null;

// First / last day of a "YYYY-MM" month as "YYYY-MM-DD" strings.
function monthRange(month: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const mm = String(mon).padStart(2, "0");
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

async function probeCapabilities(): Promise<CapsCache> {
  const capabilities: Record<string, boolean> = {
    login: false,
    accountUsers: false,
    leadsSearch: false,
    listingsModel: false,
    appraisalsModel: false,
  };
  let lastError: string | undefined;

  // (a) Does login work? Cheapest authenticated read we know is confirmed.
  try {
    const res = await rexCall("UserProfile", "getAccessibleAccounts", {});
    capabilities.login = res.ok;
    if (!res.ok) lastError = res.error ?? `Rex responded ${res.status}`;
  } catch (e) {
    lastError = e instanceof Error ? e.message : "Rex login failed";
  }

  if (capabilities.login) {
    // (b) AccountUsers/search — needed to map portal users to Rex users.
    try {
      const res = await rexCall("AccountUsers", "search", { limit: 1 });
      capabilities.accountUsers = res.ok;
      if (!res.ok && !lastError) lastError = res.error ?? undefined;
    } catch (e) {
      if (!lastError) lastError = e instanceof Error ? e.message : "AccountUsers probe failed";
    }

    // (c) Leads/search with a created-date-range criteria — the read side of
    // Rex Leads was never confirmed in TEG; an envelope error marks it false.
    try {
      const range = monthRange(new Date().toISOString().slice(0, 7))!;
      const res = await rexCall("Leads", "search", {
        criteria: [
          ["system_ctime", ">=", range.start],
          ["system_ctime", "<=", range.end],
        ],
        limit: 1,
      });
      capabilities.leadsSearch = res.ok;
      if (!res.ok && !lastError) lastError = res.error ?? undefined;
    } catch (e) {
      if (!lastError) lastError = e instanceof Error ? e.message : "Leads probe failed";
    }

    // (d) describeModel on plausible reporting services — purely recorded as
    // capability booleans so the diagnostics panel shows what exists.
    for (const [cap, model] of [
      ["listingsModel", "Listings"],
      ["appraisalsModel", "Appraisals"],
    ] as const) {
      try {
        const res = await rexCall(model, "describeModel", {});
        capabilities[cap] = res.ok;
      } catch {
        /* recorded as false */
      }
    }
  }

  return { checkedAt: Date.now(), capabilities, lastError };
}

async function getCapabilities(): Promise<CapsCache> {
  if (capsCache && Date.now() - capsCache.checkedAt < CAPS_TTL_MS) return capsCache;
  if (!capsInFlight) {
    capsInFlight = probeCapabilities()
      .then((c) => {
        capsCache = c;
        return c;
      })
      .finally(() => {
        capsInFlight = null;
      });
  }
  return capsInFlight;
}

// Integration status for the admin diagnostics panel. Instant when creds are
// missing; otherwise runs (or reuses) the capability probe. Never throws.
export async function getRexStatus(): Promise<RexStatus> {
  if (!rexConfigured()) {
    return { ok: false, reason: "not-configured", capabilities: {} };
  }
  try {
    const caps = await getCapabilities();
    return {
      ok: caps.capabilities.login === true,
      capabilities: caps.capabilities,
      lastError: caps.lastError,
      checkedAt: new Date(caps.checkedAt).toISOString(),
    };
  } catch (e) {
    return {
      ok: false,
      capabilities: {},
      lastError: e instanceof Error ? e.message : "Rex status check failed",
    };
  }
}

// Count Rex lead records assigned to one agent inside a month. Field names on
// the Leads model are UNCONFIRMED — we try a couple of plausible criteria
// shapes and give up quietly. Returns null when nothing worked.
async function countAgentLeads(
  rexUserId: string,
  start: string,
  end: string
): Promise<number | null> {
  const criteriaShapes: Array<Array<[string, string, string]>> = [
    [
      ["assignee_id", "=", rexUserId],
      ["system_ctime", ">=", start],
      ["system_ctime", "<=", end],
    ],
    [
      ["lead.assignee_id", "=", rexUserId],
      ["system_ctime", ">=", start],
      ["system_ctime", "<=", end],
    ],
  ];
  for (const criteria of criteriaShapes) {
    try {
      const res = await rexCall("Leads", "search", { criteria, limit: 100 });
      if (res.ok) return rexRows(res.result).length;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

// Best-effort live funnel for one agent + month ("YYYY-MM"). Returns a
// Partial<FunnelStats> containing ONLY stats we could genuinely compute —
// initially that is at most an MA-request count from Leads/search (a Rex Lead
// on the lettings account IS a market-appraisal request; TEG pushes them with
// lead_type "appraisal_request"). Everything unknowable stays undefined so
// resolveStat() falls back to manual/snapshot values. NEVER throws; NEVER
// takes longer than ~8s (races an overall deadline on top of per-call aborts).
export async function getAgentFunnel(
  rexUserId: string,
  month: string
): Promise<Partial<FunnelStats> | null> {
  if (!rexConfigured() || !rexUserId) return null;
  const range = monthRange(month);
  if (!range) return null;

  const work = (async (): Promise<Partial<FunnelStats> | null> => {
    const caps = await getCapabilities();
    if (!caps.capabilities.login || !caps.capabilities.leadsSearch) return null;

    const leadCount = await countAgentLeads(rexUserId, range.start, range.end);
    if (leadCount == null) return null;

    const out: Partial<FunnelStats> = {
      marketAppraisals: {
        value: leadCount,
        source: "live-rex",
        note:
          "Live count of REX lead records (MA requests) assigned to this agent " +
          `in ${month} — best-effort pull; verify against REX reporting.`,
        asOf: new Date().toISOString().slice(0, 10),
      },
    };
    return out;
  })();

  const deadline = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), OVERALL_DEADLINE_MS)
  );

  try {
    return await Promise.race([work, deadline]);
  } catch {
    return null;
  }
}
