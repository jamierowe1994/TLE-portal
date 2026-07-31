import "server-only";
import type { FunnelStats } from "./types";
import { rexCall, rexRows, rexConfigured } from "./rex";

// Per-agent funnel stats from REX — live pulls confirmed against the live
// account (3517, "The Property Experts" — Property + Lettings share it) via the
// admin probe on 12 Jul 2026.
//
// Confirmed working (named-object criteria: { name, type, value }):
//   • Market appraisals — Appraisals/search, agent_1_id + appraisal_date range
//   • Listings          — Listings/search, listing_agent_1_id (date field TBC)
//   • Leads             — Leads/search, lead.assignee_id + system_ctime
// Only marketAppraisals is wired below (date semantics fully validated:
// Rhiannon's July = 0, matching the Base44 snapshot). Listings / viewings /
// applications / move-ins stay on the snapshot until we agree which REX date
// field defines "in this month" for each — then they drop in here the same way.
//
// CONTRACT: never throw (return null → caller falls back to snapshot); never
// block a page (every rexCall is 8s-AbortController-timed + an overall 8s race);
// return ONLY stats we could truly compute.

const CAPS_TTL_MS = 10 * 60 * 1000;
const OVERALL_DEADLINE_MS = 8_000;
const COUNT_LIMIT = 100; // REX hard-caps the default result format at 100 rows

// The agent's listings underpin My Properties AND Compliance, and they flip
// between the two. Short enough that a change in REX shows up promptly.
const LISTINGS_TTL_MS = 60_000;
const listingsCache = new Map<string, { at: number; data: AgentListing[] }>();

type Criterion = { name: string; type: string; value: string | string[] };

export interface RexStatus {
  ok: boolean;
  reason?: string;
  capabilities: Record<string, boolean>;
  lastError?: string;
  checkedAt?: string;
}

export interface AgentPortfolio {
  managed: number; // properties this agent has let & manages (REX "leased")
  rentRoll: number; // £/month — sum of monthly rent across those properties
}

interface CapsCache {
  checkedAt: number;
  capabilities: Record<string, boolean>;
  lastError?: string;
}

let capsCache: CapsCache | null = null;
let capsInFlight: Promise<CapsCache> | null = null;

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

// Rows a search returns, or null on any failure. Rex caps at COUNT_LIMIT.
async function searchRows(
  service: string,
  criteria: Criterion[]
): Promise<Array<Record<string, unknown>> | null> {
  try {
    const res = await rexCall(service, "search", { criteria, limit: COUNT_LIMIT });
    return res.ok ? rexRows(res.result) : null;
  } catch {
    return null;
  }
}

// Count rows a search returns, or null on any failure.
async function countSearch(service: string, criteria: Criterion[]): Promise<number | null> {
  const rows = await searchRows(service, criteria);
  return rows ? rows.length : null;
}

async function probeCapabilities(): Promise<CapsCache> {
  const capabilities: Record<string, boolean> = {
    login: false,
    accountUsers: false,
    appraisals: false,
    listings: false,
    leads: false,
  };
  let lastError: string | undefined;

  try {
    const res = await rexCall("UserProfile", "getAccessibleAccounts", {});
    capabilities.login = res.ok;
    if (!res.ok) lastError = res.error ?? `Rex responded ${res.status}`;
  } catch (e) {
    lastError = e instanceof Error ? e.message : "Rex login failed";
  }

  if (capabilities.login) {
    const checks: Array<[string, () => Promise<boolean>]> = [
      ["accountUsers", async () => (await rexCall("AccountUsers", "search", { limit: 1 })).ok],
      [
        "appraisals",
        async () =>
          (await rexCall("Appraisals", "search", {
            criteria: [{ name: "appraisal_date", type: ">=", value: "2000-01-01" }],
            limit: 1,
          })).ok,
      ],
      ["listings", async () => (await rexCall("Listings", "search", { limit: 1 })).ok],
      [
        "leads",
        async () =>
          (await rexCall("Leads", "search", {
            criteria: [{ name: "system_ctime", type: ">=", value: "2000-01-01" }],
            limit: 1,
          })).ok,
      ],
    ];
    for (const [cap, fn] of checks) {
      try {
        capabilities[cap] = await fn();
      } catch {
        /* recorded false */
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

/* --------------------------- market appraisals ---------------------------- */

// One counted market appraisal. `kind` is not decoration: half these rows are
// instructions with no appraisal recorded against them, and a partner looking
// at the list needs to see why a property they never appraised is in it.
export interface AgentAppraisal {
  /** REX property id — the key both halves of the combined definition join on. */
  propertyId: string;
  address: string;
  /** Appraisal date, or the date the instruction was created for listing-only rows. */
  date: string | null;
  kind: "appraisal" | "listing-only";
}

export interface AgentAppraisals {
  /** Appraisals actually recorded in REX this month. */
  recorded: number;
  /** Susan's combined figure, or null when the listing half couldn't be built. */
  combined: number | null;
  /** The records behind the figure — `combined` of them, or `recorded` when null. */
  rows: AgentAppraisal[];
}

const APPRAISALS_TTL_MS = 60_000;
const appraisalsCache = new Map<string, { at: number; data: AgentAppraisals }>();
// The dashboard asks for the count and the rows in the same request, in
// parallel — without in-flight sharing that's two identical four-call sweeps
// racing each other, and the cache only helps the request after.
const appraisalsInFlight = new Map<string, Promise<AgentAppraisals | null>>();

// REX gives the address in parts on every service; system_search_key is its own
// combined form and is the closest thing to what staff see in REX itself.
function propertyAddress(p: Record<string, unknown> | null | undefined): string {
  if (!p) return "Address unavailable";
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const key = str(p.system_search_key);
  if (key) return key;
  const unit = str(p.adr_unit_number);
  const street = [str(p.adr_street_number), str(p.adr_street_name)]
    .filter(Boolean)
    .join(" ");
  const locality = [str(p.adr_suburb_or_town), str(p.adr_postcode)]
    .filter(Boolean)
    .join(" ");
  return (
    [[unit, street].filter(Boolean).join(", "), locality].filter(Boolean).join(", ") ||
    "Address unavailable"
  );
}

const propertyIdOf = (r: Record<string, unknown>): string =>
  String(((r.property as { id?: unknown }) ?? {}).id ?? "");

/**
 * The agent's market appraisals for a month, ON SUSAN'S COMBINED DEFINITION:
 * appraisals recorded in REX, plus this month's instructions whose property has
 * no same-month appraisal against it. Partners used to see recorded appraisals
 * only, which counted 7 where the business counted 41 — and since MA -> Listing
 * divides by it, that flattered every partner's conversion rate.
 *
 * Returns the RECORDS, not just a count, so the tile and the list it opens are
 * literally the same array. Same logic as getBusinessMonthCounts below, which
 * is validated against Susan's June finals.
 *
 * Cached per agent+month: the dashboard asks for the count and the rows in the
 * same request, and this is four REX round-trips.
 */
export async function getAgentAppraisals(
  rexUserId: string,
  month: string
): Promise<AgentAppraisals | null> {
  if (!rexConfigured() || !rexUserId) return null;
  const range = monthRange(month);
  if (!range) return null;

  const key = `${rexUserId}:${month}`;
  const cached = appraisalsCache.get(key);
  if (cached && Date.now() - cached.at < APPRAISALS_TTL_MS) return cached.data;
  const inFlight = appraisalsInFlight.get(key);
  if (inFlight) return inFlight;

  const work = (async (): Promise<AgentAppraisals | null> => {
    const recordedRows = await pagedSearch("Appraisals", [
      { name: "agent_1_id", type: "=", value: rexUserId },
      { name: "appraisal_date", type: ">=", value: range.start },
      { name: "appraisal_date", type: "<=", value: range.end },
    ]);
    // Null here is "couldn't ask", not "none" — the caller keeps the snapshot.
    if (!recordedRows) return null;

    const recorded: AgentAppraisal[] = recordedRows.map((r) => ({
      propertyId: propertyIdOf(r),
      address: propertyAddress(r.property as Record<string, unknown> | undefined),
      date: typeof r.appraisal_date === "string" ? r.appraisal_date.slice(0, 10) : null,
      kind: "appraisal",
    }));

    const finish = (data: AgentAppraisals): AgentAppraisals => {
      appraisalsCache.set(key, { at: Date.now(), data });
      return data;
    };
    // An undercount beats an empty tile: if either listing-side call fails we
    // report the recorded appraisals alone rather than nothing.
    const recordedOnly = (): AgentAppraisals =>
      finish({ recorded: recorded.length, combined: null, rows: recorded });

    const monthListings = await pagedSearch("Listings", [
      { name: "listing_agent_1_id", type: "=", value: rexUserId },
      { name: "system_ctime", type: ">=", value: epoch(range.start) },
      { name: "system_ctime", type: "<", value: String(Number(epoch(range.end)) + 86_400) },
    ]);
    if (!monthListings) return recordedOnly();

    // Duplicates kept — two listings on one property are two instructions —
    // but the overlap query only needs each property id once.
    const perListing: AgentAppraisal[] = monthListings
      .filter(isRentalListing)
      .map((r) => {
        const ctime = Number(r.system_ctime);
        return {
          propertyId: propertyIdOf(r),
          address: propertyAddress(r.property as Record<string, unknown> | undefined),
          date:
            Number.isFinite(ctime) && ctime > 0
              ? new Date(ctime * 1000).toISOString().slice(0, 10)
              : null,
          kind: "listing-only" as const,
        };
      })
      .filter((l) => l.propertyId !== "");

    let listingOnly: AgentAppraisal[] = [];
    const unique = [...new Set(perListing.map((l) => l.propertyId))];
    if (unique.length) {
      const overlap = await pagedSearch("Appraisals", [
        { name: "property_id", type: "in", value: unique },
        { name: "appraisal_date", type: ">=", value: range.start },
        { name: "appraisal_date", type: "<=", value: range.end },
      ]);
      if (!overlap) return recordedOnly();
      const withMa = new Set(overlap.map(propertyIdOf));
      listingOnly = perListing.filter((l) => !withMa.has(l.propertyId));
    }

    const rows = [...recorded, ...listingOnly].sort((a, b) =>
      (b.date ?? "").localeCompare(a.date ?? "")
    );
    return finish({
      recorded: recorded.length,
      combined: recorded.length + listingOnly.length,
      rows,
    });
  })();

  const deadline = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), OVERALL_DEADLINE_MS)
  );
  const raced = Promise.race([work, deadline]).catch(() => null);
  appraisalsInFlight.set(key, raced);
  try {
    return await raced;
  } finally {
    appraisalsInFlight.delete(key);
  }
}

// Best-effort live funnel for one agent + month ("YYYY-MM"). Returns a
// Partial<FunnelStats> with ONLY the stats we could genuinely compute — today
// that is marketAppraisals from the Appraisals service. Everything else stays
// undefined so the caller keeps the snapshot. Never throws; never > ~8s.
export async function getAgentFunnel(
  rexUserId: string,
  month: string
): Promise<Partial<FunnelStats> | null> {
  if (!rexConfigured() || !rexUserId) return null;
  const range = monthRange(month);
  if (!range) return null;

  const work = (async (): Promise<Partial<FunnelStats> | null> => {
    const caps = await getCapabilities();
    if (!caps.capabilities.login) return null;

    const out: Partial<FunnelStats> = {};
    const asOf = new Date().toISOString().slice(0, 10);

    // Market appraisals come from getAgentAppraisals, which builds the records
    // and counts them — so this tile can never say a different number from the
    // list it opens. It caches, so the route asking for the rows as well costs
    // nothing.
    if (caps.capabilities.appraisals) {
      const mas = await getAgentAppraisals(rexUserId, month);
      if (mas) {
        out.marketAppraisals = {
          value: mas.combined ?? mas.recorded,
          source: "live-rex",
          note:
            mas.combined != null
              ? `Live from REX — ${mas.recorded} recorded appraisal${mas.recorded === 1 ? "" : "s"} plus this month's instructions with no appraisal against them. Same definition the business reports on.`
              : `Live count from REX Appraisals (agent_1_id, appraisal_date in ${month}).`,
          asOf,
        };
      }
    }

    // Listings + pipeline — one pull of the agent's on-market ("current")
    // listings, split by let_agreed. These are CURRENT-state counts (properties
    // on the market / deals agreed right now), not month-bound. Move-ins are
    // deliberately NOT pulled — they live in PayProp, not REX.
    if (caps.capabilities.listings) {
      const rows = await searchRows("Listings", [
        { name: "listing_agent_1_id", type: "=", value: rexUserId },
        { name: "system_listing_state", type: "=", value: "current" },
      ]);
      if (rows) {
        const letAgreed = rows.filter((r) => r.let_agreed === true).length;
        out.listings = {
          value: rows.length - letAgreed,
          source: "live-rex",
          note: "Live: properties on the market now (REX 'current' listings, excluding let-agreed).",
          asOf,
        };
        out.pipeline = {
          value: letAgreed,
          source: "live-rex",
          note: "Live: let agreed, awaiting completion (REX 'current' listings flagged let_agreed).",
          asOf,
        };
      }
    }

    return Object.keys(out).length ? out : null;
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

/* ----------------------- business-wide month counts ----------------------- */

// Month-bound funnel counts summed across the whole lettings side (agent-id
// "in" criteria keep The Property Experts' sales data out — the REX account is
// shared). Each stat is independent: a null means "couldn't compute, keep the
// snapshot", never zero.
//
// Date semantics — VALIDATED against Susan's June finals (21 Jul 2026):
//   applications — application.date_accepted in month (June: 24 vs her 25).
//                  Her "Applications" column means ACCEPTED applications;
//                  date_received counts every application (June: 83).
//   newListings  — created in month (system_ctime, EPOCH SECONDS — date
//                  strings silently match nothing), Residential Rental only,
//                  drafts excluded (June: ~38 vs her 35).
//   viewings     — CalendarEvents typed "TLE Accompanied/Unaccompanied
//                  Viewing" (ids 953/956) starting in month, cancellations
//                  excluded (June: 221 vs her 202). Business-wide by type —
//                  calendar events carry no owning agent.
export interface BusinessMonthCounts {
  applications: number | null;
  newListings: number | null;
  viewings: number | null;
  /** Recorded appraisals in month. */
  marketAppraisals: number | null;
  /** Susan's "combined MAs": recorded + listings created in month whose
   *  property has no same-month recorded appraisal (June check: 41 vs her 40). */
  combinedMas: number | null;
}

const TLE_VIEWING_TYPE_IDS = ["953", "956"];

const monthCountsCache = new Map<string, { at: number; data: BusinessMonthCounts }>();
const MONTH_COUNTS_TTL_MS = 5 * 60 * 1000;
// Month counts page through a few hundred calendar rows — allow more than the
// per-agent 8s budget, but still bounded (the admin Overview races this).
const MONTH_COUNTS_DEADLINE_MS = 25_000;

// All rows matching criteria, paged past REX's 100-row cap. null on failure.
async function pagedSearch(
  service: string,
  criteria: Criterion[],
  maxRows = 1000
): Promise<Array<Record<string, unknown>> | null> {
  const out: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < maxRows; offset += COUNT_LIMIT) {
    try {
      const res = await rexCall(service, "search", { criteria, limit: COUNT_LIMIT, offset });
      if (!res.ok) return null;
      const page = rexRows(res.result);
      out.push(...page);
      if (page.length < COUNT_LIMIT) break;
    } catch {
      return null;
    }
  }
  return out;
}

function epoch(date: string): string {
  return String(Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000));
}

export async function getBusinessMonthCounts(
  month: string,
  agentIds: string[],
  force = false
): Promise<BusinessMonthCounts | null> {
  if (!rexConfigured() || agentIds.length === 0) return null;
  const range = monthRange(month);
  if (!range) return null;

  const cached = monthCountsCache.get(month);
  if (!force && cached && Date.now() - cached.at < MONTH_COUNTS_TTL_MS) return cached.data;

  const work = (async (): Promise<BusinessMonthCounts | null> => {
    const [applications, marketAppraisals, listingRows, viewingRows] = await Promise.all([
      countSearch("TenancyApplications", [
        { name: "application.agent_id", type: "in", value: agentIds },
        { name: "application.date_accepted", type: ">=", value: range.start },
        { name: "application.date_accepted", type: "<=", value: range.end },
      ]),
      countSearch("Appraisals", [
        { name: "agent_1_id", type: "in", value: agentIds },
        { name: "appraisal_date", type: ">=", value: range.start },
        { name: "appraisal_date", type: "<=", value: range.end },
      ]),
      pagedSearch("Listings", [
        { name: "listing_agent_1_id", type: "in", value: agentIds },
        { name: "system_ctime", type: ">=", value: epoch(range.start) },
        { name: "system_ctime", type: "<", value: String(Number(epoch(range.end)) + 86_400) },
      ]),
      pagedSearch("CalendarEvents", [
        { name: "appointment_type_id", type: "in", value: TLE_VIEWING_TYPE_IDS },
        { name: "starts_at", type: ">=", value: `${range.start} 00:00:00` },
        { name: "starts_at", type: "<=", value: `${range.end} 23:59:59` },
      ]),
    ]);

    const keptListings = listingRows
      ? listingRows.filter((r) => {
          const cat = r.listing_category as { id?: string; text?: string } | string | null;
          const catText = typeof cat === "object" && cat ? (cat.text ?? cat.id) : cat;
          const pub = r.system_publication_status as { id?: string } | string | null;
          const pubId = typeof pub === "object" && pub ? pub.id : pub;
          return String(catText ?? "").toLowerCase().includes("rental") && pubId !== "draft";
        })
      : null;
    const newListings = keptListings ? keptListings.length : null;

    // Combined MAs (Susan's definition): recorded appraisals + this month's
    // listings whose property has NO same-month recorded appraisal. Validated
    // June: 7 recorded + 34 listing-only = 41 vs her 40.
    let combinedMas: number | null = null;
    if (marketAppraisals != null && keptListings) {
      // Per-listing property ids (dupes kept — two listings on one property
      // are two instructions); unique set only for the overlap query.
      const perListing = keptListings
        .map((r) => String(((r.property as { id?: unknown }) ?? {}).id ?? ""))
        .filter(Boolean);
      const unique = [...new Set(perListing)];
      let listingOnly: number | null = unique.length ? null : 0;
      if (unique.length) {
        const overlapRows = await pagedSearch("Appraisals", [
          { name: "property_id", type: "in", value: unique },
          { name: "appraisal_date", type: ">=", value: range.start },
          { name: "appraisal_date", type: "<=", value: range.end },
        ]);
        if (overlapRows) {
          const withMa = new Set(
            overlapRows.map((r) => String(((r.property as { id?: unknown }) ?? {}).id ?? ""))
          );
          listingOnly = perListing.filter((p) => !withMa.has(p)).length;
        }
      }
      if (listingOnly != null) combinedMas = marketAppraisals + listingOnly;
    }

    const viewings = viewingRows
      ? viewingRows.filter((r) => !(r.is_cancelled === true || r.is_cancelled === 1)).length
      : null;

    if (applications == null && newListings == null && viewings == null && marketAppraisals == null) {
      return null;
    }
    const data = { applications, newListings, viewings, marketAppraisals, combinedMas };
    monthCountsCache.set(month, { at: Date.now(), data });
    return data;
  })();

  const deadline = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), MONTH_COUNTS_DEADLINE_MS)
  );
  try {
    return await Promise.race([work, deadline]);
  } catch {
    return null;
  }
}

/* ------------------------------ ramp window ------------------------------ */

// Was a listing row a real (non-draft) rental instruction? Shared with the
// business month-counts logic above.
function isRentalListing(r: Record<string, unknown>): boolean {
  const cat = r.listing_category as { id?: string; text?: string } | string | null;
  const catText = typeof cat === "object" && cat ? (cat.text ?? cat.id) : cat;
  const pub = r.system_publication_status as { id?: string } | string | null;
  const pubId = typeof pub === "object" && pub ? pub.id : pub;
  return String(catText ?? "").toLowerCase().includes("rental") && pubId !== "draft";
}

export interface AgentRampCounts {
  /** Recorded market appraisals in [start, end]. */
  marketAppraisals: number | null;
  /** Rental listings created (non-draft) in [start, end]. */
  listings: number | null;
}

/**
 * One agent's productivity in a date window [startISO, endISO] — the REX half
 * of ramp-time reporting (MAs + listings a new starter generated in their
 * first N days). Move-ins come from Propoly (getAgentMoveInsInWindow), which
 * REX doesn't hold. null figures = couldn't ask; caller shows "—".
 */
export async function getAgentRampCounts(
  rexUserId: string,
  startISO: string,
  endISO: string
): Promise<AgentRampCounts | null> {
  if (!rexConfigured() || !rexUserId) return null;

  const work = (async (): Promise<AgentRampCounts | null> => {
    const [maCount, listingRows] = await Promise.all([
      countSearch("Appraisals", [
        { name: "agent_1_id", type: "=", value: rexUserId },
        { name: "appraisal_date", type: ">=", value: startISO },
        { name: "appraisal_date", type: "<=", value: endISO },
      ]),
      pagedSearch("Listings", [
        { name: "listing_agent_1_id", type: "=", value: rexUserId },
        { name: "system_ctime", type: ">=", value: epoch(startISO) },
        { name: "system_ctime", type: "<", value: String(Number(epoch(endISO)) + 86_400) },
      ]),
    ]);
    const listings = listingRows ? listingRows.filter(isRentalListing).length : null;
    if (maCount == null && listings == null) return null;
    return { marketAppraisals: maCount, listings };
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

// The agent's managed portfolio (count + monthly rent roll) from their leased
// listings. Live, current-state. null on any failure → caller keeps snapshot.
const rentRollCache = new Map<string, { at: number; data: AgentPortfolio }>();

export async function getAgentPortfolio(rexUserId: string): Promise<AgentPortfolio | null> {
  if (!rexConfigured() || !rexUserId) return null;

  // Cached like its neighbours. Without this every dashboard load re-ran the
  // leased-listings search — the one call on this route with no cache at all.
  const cached = rentRollCache.get(rexUserId);
  if (cached && Date.now() - cached.at < LISTINGS_TTL_MS) return cached.data;

  const work = (async (): Promise<AgentPortfolio | null> => {
    const caps = await getCapabilities();
    if (!caps.capabilities.login || !caps.capabilities.listings) return null;

    const rows = await searchRows("Listings", [
      { name: "listing_agent_1_id", type: "=", value: rexUserId },
      { name: "system_listing_state", type: "=", value: "leased" },
    ]);
    if (!rows) return null;

    let rentRoll = 0;
    for (const r of rows) {
      const rent = Number(r.price_rent);
      if (Number.isFinite(rent) && rent > 0) rentRoll += rent;
    }
    const data = { managed: rows.length, rentRoll };
    rentRollCache.set(rexUserId, { at: Date.now(), data });
    return data;
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

/* ---------------------------- the agent's listings --------------------------- */

// One of the agent's properties, flattened out of REX's very wide Listings row
// into just what the portal shows. REX's own layout is unusable at a glance —
// this is the shape the CRM-style list is built from.
export interface AgentListing {
  id: string;
  /** REX property id — compliance entries hang off this, not the listing id. */
  propertyId: string;
  /** Full display address — REX's combined search key. Used for sorting/search. */
  address: string;
  /** Street line, e.g. "5 The Lime Tree Court Commercial Road" — the headline. */
  name: string;
  /** Town + postcode, e.g. "Paignton TQ4 5DR" — the line under the name. */
  locality: string;
  rent: number | null;
  rentPeriod: string | null; // "Month"
  advertisedAs: string | null; // "£1,200"
  availableFrom: string | null;
  letAgreed: boolean;
  /** REX publication state — "draft" listings aren't live on portals yet. */
  publicationStatus: string | null;
  category: string | null; // "Residential Rental"
  letType: string | null; // "Long Term"
  minTermMonths: number | null;
  /** EPC rides on the listing itself — no property join needed. */
  epcExpiry: string | null;
  epcRating: number | null;
  epcNotRequired: boolean;
  /** Hero shot (REX priority 1), 400x300 thumb. null when none uploaded. */
  image: string | null;
  imageCount: number;
  /** Every photo in REX order, 800x600 thumbs — feeds the drawer carousel. */
  images: string[];
}

// REX returns lookups as { id, text } and plain values elsewhere — normalise.
function label(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object") {
    const o = v as { text?: string; name?: string; id?: string };
    return o.text ?? o.name ?? o.id ?? null;
  }
  return String(v);
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// REX image urls come back protocol-relative ("//uk-crm.cdns…") — make them
// absolute so the browser doesn't resolve them against our own origin.
function absoluteUrl(u: unknown): string | null {
  if (typeof u !== "string" || !u) return null;
  if (u.startsWith("//")) return `https:${u}`;
  return u;
}

/**
 * The listing's photos, REX priority order (1 = first). REX ships pre-made
 * thumbs — the tile takes the 400x300 hero, the drawer carousel gets 800x600s
 * rather than pulling 1200x800 originals per photo.
 */
function listingImages(r: Record<string, unknown>): {
  url: string | null;
  count: number;
  all: string[];
} {
  const related = (r.related ?? {}) as Record<string, unknown>;
  const images = Array.isArray(related.listing_images)
    ? (related.listing_images as Array<Record<string, unknown>>)
    : [];
  if (images.length === 0) return { url: null, count: 0, all: [] };

  const ordered = [...images].sort(
    (a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999)
  );
  const thumb = (img: Record<string, unknown>, size: string): string | null => {
    const thumbs = (img.thumbs ?? {}) as Record<string, { url?: string }>;
    return absoluteUrl(thumbs[size]?.url) ?? absoluteUrl(img.url);
  };
  const url = thumb(ordered[0], "400x300");
  const all = ordered
    .map((img) => thumb(img, "800x600"))
    .filter((u): u is string => u != null);
  return { url, count: images.length, all };
}

function toListing(r: Record<string, unknown>): AgentListing {
  const property = (r.property ?? {}) as Record<string, unknown>;
  const hero = listingImages(r);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  // REX gives the address in parts; split it the way an address is actually
  // read — the unit + street line as the headline, town + postcode beneath.
  //
  // adr_unit_number ("Flat 3", "Room 5") is NOT optional dressing: half this
  // portfolio is rooms and flats, so without it "Room 3, 5a Newton Road" and
  // "Room 5, 5a Newton Road" collapse into the same tile and the agent can't
  // tell two of their own properties apart.
  const unit = str(property.adr_unit_number);
  const street =
    [str(property.adr_street_number), str(property.adr_street_name)]
      .filter(Boolean)
      .join(" ") || null;
  const name = [unit, street].filter(Boolean).join(", ") || null;
  const locality =
    [str(property.adr_suburb_or_town), str(property.adr_postcode)]
      .filter(Boolean)
      .join(" ") || null;
  const address =
    str(property.system_search_key) ??
    [name, locality].filter(Boolean).join(", ") ??
    "Address unavailable";

  return {
    id: String(r.id ?? ""),
    propertyId: String(property.id ?? ""),
    address: String(address).trim(),
    name: name ?? String(address).trim(),
    locality: locality ?? "",
    rent: num(r.price_rent),
    rentPeriod: label(r.price_rent_period),
    advertisedAs: (r.price_advertise_as as string) ?? null,
    availableFrom: (r.available_from_date as string) ?? null,
    letAgreed: r.let_agreed === true,
    publicationStatus: label(r.system_publication_status),
    category: label(r.listing_category),
    letType: label(r.let_type),
    minTermMonths: num(r.let_minimum_term_months),
    epcExpiry: (r.epc_expiry_date as string) ?? null,
    epcRating: num(r.epc_current_eer),
    epcNotRequired: r.epc_not_required === 1 || r.epc_not_required === true,
    image: hero.url,
    imageCount: hero.count,
    images: hero.all,
  };
}

/**
 * The agent's live properties — REX "current" listings, on the market or let
 * agreed. Live, current-state. null on any failure so the caller can say so
 * rather than render an empty list as though they have none.
 */
export async function getAgentListings(
  rexUserId: string
): Promise<AgentListing[] | null> {
  if (!rexConfigured() || !rexUserId) return null;

  const cached = listingsCache.get(rexUserId);
  if (cached && Date.now() - cached.at < LISTINGS_TTL_MS) return cached.data;

  const work = (async (): Promise<AgentListing[] | null> => {
    // No capabilities probe here on purpose. It cost ~2.2s of REX round-trips
    // (five calls that fetch nothing) before every request, to answer a question
    // the search itself answers: if Listings is unavailable the call fails and we
    // return null exactly the same. It stays in getAgentFunnel, where it really
    // does gate optional services.
    //
    // extra_fields pulls the photos in with the listings — one call, not one
    // per property.
    const res = await rexCall("Listings", "search", {
      criteria: [
        { name: "listing_agent_1_id", type: "=", value: rexUserId },
        { name: "system_listing_state", type: "=", value: "current" },
      ],
      extra_options: { extra_fields: ["related.listing_images"] },
      limit: COUNT_LIMIT,
    }).catch(() => null);
    if (!res || !res.ok) return null;

    const listings = rexRows(res.result)
      .map(toListing)
      .sort((a, b) => a.address.localeCompare(b.address, "en-GB"));
    // Compliance builds on this same call, and agents hop between the two — a
    // short cache makes the second page instant instead of refetching.
    listingsCache.set(rexUserId, { at: Date.now(), data: listings });
    return listings;
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

/* --------------------------- property compliance --------------------------- */

// Property compliance only. REX also stores contact-level checks (AML, Right to
// Rent, NRL) as ComplianceEntries hanging off contacts — different job, kept out.
const PROPERTY_COMPLIANCE: Record<string, string> = {
  epc: "EPC",
  gas_safety: "Gas safety",
  eicr: "Electrical (EICR)",
  legionella_risk_assessment: "Legionella risk assessment",
  smoke_alarms: "Smoke alarms",
  co_alarms: "CO alarms",
  emergency_lighting_fire_exit: "Emergency lighting / fire exit",
  portable_appliance_testing: "PAT testing",
  oil_safety: "Oil safety",
  mandatory_hmo_license: "HMO licence (mandatory)",
  additional_hmo_license: "HMO licence (additional)",
  selective_hmo_license: "HMO licence (selective)",
  listing_proof_of_ownership: "Proof of ownership",
  terms_of_business: "Terms of business",
};

export type ComplianceState =
  | "valid"
  | "expiring"
  | "expired"
  | "missing"
  | "not-required";

export interface ComplianceItem {
  type: string;
  label: string;
  state: ComplianceState;
  expiry: string | null;
  notes: string | null;
}

export interface PropertyCompliance {
  listingId: string;
  name: string;
  locality: string;
  image: string | null;
  items: ComplianceItem[];
  /** How many items need a human — drives the "needs attention" sort. */
  outstanding: number;
}

const EXPIRING_DAYS = 60;

export function complianceNeedsWork(s: ComplianceState): boolean {
  return s === "expired" || s === "expiring" || s === "missing";
}

/**
 * Every entry carries the same shape under details[type]:
 *   { notes, issue_date, expiry_date, not_required }
 * `not_required` is an explicit answer ("No gas in building"), not a gap — so
 * it's never outstanding. A record with no dates at all is genuinely
 * incomplete; one with an issue_date but no expiry simply doesn't expire.
 */
function toComplianceItem(entry: Record<string, unknown>): ComplianceItem | null {
  const type = String(label(entry.type_id) ?? "");
  const name = PROPERTY_COMPLIANCE[type];
  if (!name) return null; // contact-level or unknown — not our concern here

  const details = (entry.details ?? {}) as Record<string, unknown>;
  const d = (details[type] ?? {}) as Record<string, unknown>;
  const expiry = typeof d.expiry_date === "string" ? d.expiry_date : null;
  const issued = typeof d.issue_date === "string" ? d.issue_date : null;
  const notes = typeof d.notes === "string" && d.notes.trim() ? d.notes.trim() : null;

  let state: ComplianceState;
  if (d.not_required === true) {
    state = "not-required";
  } else if (expiry) {
    const days = Math.round((new Date(expiry).getTime() - Date.now()) / 86_400_000);
    state = days < 0 ? "expired" : days <= EXPIRING_DAYS ? "expiring" : "valid";
  } else if (issued) {
    state = "valid"; // recorded, and this type doesn't carry an expiry
  } else {
    state = "missing";
  }

  return { type, label: name, state, expiry, notes };
}

// REX can hold the same certificate against BOTH the property and the listing
// (the managed book does this a lot) — merging the two parents then shows "EPC"
// twice. One item per type: keep whichever needs a human, else the later expiry
// (the current certificate, not the superseded one).
const STATE_URGENCY: Record<ComplianceState, number> = {
  expired: 4,
  expiring: 3,
  missing: 2,
  valid: 1,
  "not-required": 0,
};

// ComplianceEntries searches slow superlinearly with the id count (92 ids →
// 21s measured 29 Jul 2026) and hard-cap at 100 rows. Small parallel chunks
// keep each call fast and under the cap. A failed chunk costs its properties'
// items, not the whole page.
const COMPLIANCE_CHUNK = 10;

async function fetchComplianceByParent(
  ids: string[]
): Promise<Map<string, ComplianceItem[]>> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += COMPLIANCE_CHUNK) {
    chunks.push(ids.slice(i, i + COMPLIANCE_CHUNK));
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      rexCall("ComplianceEntries", "search", {
        criteria: [{ name: "parent_object_id", type: "in", value: chunk }],
        limit: COUNT_LIMIT,
      }).catch(() => null)
    )
  );

  const byParent = new Map<string, ComplianceItem[]>();
  for (const res of results) {
    if (!res || !res.ok) continue;
    for (const row of rexRows(res.result)) {
      const item = toComplianceItem(row);
      if (!item) continue;
      const parent = String(row.parent_object_id ?? "");
      if (!parent) continue;
      const list = byParent.get(parent) ?? [];
      list.push(item);
      byParent.set(parent, list);
    }
  }
  return byParent;
}

function dedupeComplianceItems(items: ComplianceItem[]): ComplianceItem[] {
  const byType = new Map<string, ComplianceItem>();
  for (const item of items) {
    const seen = byType.get(item.type);
    if (
      !seen ||
      STATE_URGENCY[item.state] > STATE_URGENCY[seen.state] ||
      (STATE_URGENCY[item.state] === STATE_URGENCY[seen.state] &&
        String(item.expiry ?? "") > String(seen.expiry ?? ""))
    ) {
      byType.set(item.type, item);
    }
  }
  return [...byType.values()];
}

const COMPLIANCE_TTL_MS = 60_000;
const complianceCache = new Map<string, { at: number; data: PropertyCompliance[] }>();

/**
 * The agent's properties with their compliance, worst first. Live from REX.
 * null on failure so the caller can say so rather than imply all-clear.
 * Short-cached per agent — the join costs several REX round-trips.
 */
export async function getAgentCompliance(
  rexUserId: string
): Promise<PropertyCompliance[] | null> {
  if (!rexConfigured() || !rexUserId) return null;

  const cached = complianceCache.get(rexUserId);
  if (cached && Date.now() - cached.at < COMPLIANCE_TTL_MS) return cached.data;

  const work = (async (): Promise<PropertyCompliance[] | null> => {
    const listings = await getAgentListings(rexUserId);
    if (!listings) return null;

    // Compliance hangs off the property (and sometimes the listing), so ask for
    // both ids in one go rather than a call per property.
    const propertyIds = listings.map((l) => l.propertyId).filter(Boolean);
    const ids = [...new Set([...propertyIds, ...listings.map((l) => l.id)])];
    if (ids.length === 0) return [];

    const byParent = await fetchComplianceByParent(ids);

    const out = listings.map((l) => {
      const items = dedupeComplianceItems([
        ...(byParent.get(l.propertyId) ?? []),
        ...(byParent.get(l.id) ?? []),
      ]).sort((a, b) => a.label.localeCompare(b.label));
      return {
        listingId: l.id,
        name: l.name,
        locality: l.locality,
        image: l.image,
        items,
        outstanding: items.filter((i) => complianceNeedsWork(i.state)).length,
      };
    });

    // Worst first — this page exists to surface what needs doing.
    out.sort(
      (a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name, "en-GB")
    );
    complianceCache.set(rexUserId, { at: Date.now(), data: out });
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

/* ------------------------------ my portfolio ------------------------------ */

// A property the agent has let and now manages — REX "leased" listings, joined
// with their compliance entries. This is the "after the let" view: My
// Properties is the market, this is the book.
export interface PortfolioProperty {
  listingId: string;
  /** REX property id — the record maintenance/compliance hangs off in REX. */
  propertyId: string;
  name: string;
  locality: string;
  address: string;
  image: string | null;
  /** Every photo in REX order, 800x600 thumbs — feeds the drawer carousel. */
  images: string[];
  rent: number | null;
  rentPeriod: string | null;
  letType: string | null;
  /**
   * When the listing was created in REX — the closest thing the Listings row
   * gives us to "joined the portfolio". Good for "on the books since", not a
   * tenancy start date.
   */
  sinceISO: string | null;
  epcExpiry: string | null;
  epcRating: number | null;
  epcNotRequired: boolean;
  items: ComplianceItem[];
  /** How many compliance items need a human — drives badges + sort. */
  outstanding: number;
  /** The soonest certificate renewal (incl. overdue), or null if none dated. */
  nextRenewal: { label: string; expiry: string } | null;
}

// The managed book is much bigger than the market book (50 properties vs ~12),
// so even the chunked compliance fetch adds up — longer deadline, longer cache.
const PORTFOLIO_TTL_MS = 5 * 60_000;
const PORTFOLIO_DEADLINE_MS = 20_000;
const portfolioCache = new Map<string, { at: number; data: PortfolioProperty[] }>();

/**
 * The agent's managed portfolio with compliance, worst first. Two REX calls:
 * leased Listings (with images), then ComplianceEntries for the lot.
 * null on failure so the caller can say so rather than imply an empty book.
 */
export async function getAgentPortfolioProperties(
  rexUserId: string
): Promise<PortfolioProperty[] | null> {
  if (!rexConfigured() || !rexUserId) return null;

  const cached = portfolioCache.get(rexUserId);
  if (cached && Date.now() - cached.at < PORTFOLIO_TTL_MS) return cached.data;

  const work = (async (): Promise<PortfolioProperty[] | null> => {
    const res = await rexCall("Listings", "search", {
      criteria: [
        { name: "listing_agent_1_id", type: "=", value: rexUserId },
        { name: "system_listing_state", type: "=", value: "leased" },
      ],
      extra_options: { extra_fields: ["related.listing_images"] },
      limit: COUNT_LIMIT,
    }).catch(() => null);
    if (!res || !res.ok) return null;

    const rows = rexRows(res.result);
    const listings = rows.map((r) => {
      // system_ctime is epoch seconds; anything non-numeric → unknown.
      const ctime = Number(r.system_ctime);
      const sinceISO =
        Number.isFinite(ctime) && ctime > 0
          ? new Date(ctime * 1000).toISOString().slice(0, 10)
          : null;
      return { base: toListing(r), sinceISO };
    });

    const ids = [
      ...new Set(
        listings.flatMap((l) => [l.base.propertyId, l.base.id]).filter(Boolean)
      ),
    ];
    const byParent = await fetchComplianceByParent(ids);

    const out: PortfolioProperty[] = listings.map(({ base: l, sinceISO }) => {
      const items = dedupeComplianceItems([
        ...(byParent.get(l.propertyId) ?? []),
        ...(byParent.get(l.id) ?? []),
      ]).sort((a, b) => a.label.localeCompare(b.label));

      // Soonest dated renewal, overdue first — expired certs are the most
      // urgent "renewal due", not a separate category.
      const dated = items
        .filter((i) => i.expiry && i.state !== "not-required")
        .sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));
      const next = dated[0] ?? null;

      return {
        listingId: l.id,
        propertyId: l.propertyId,
        name: l.name,
        locality: l.locality,
        address: l.address,
        image: l.image,
        images: l.images,
        rent: l.rent,
        rentPeriod: l.rentPeriod,
        letType: l.letType,
        sinceISO,
        epcExpiry: l.epcExpiry,
        epcRating: l.epcRating,
        epcNotRequired: l.epcNotRequired,
        items,
        outstanding: items.filter((i) => complianceNeedsWork(i.state)).length,
        nextRenewal: next ? { label: next.label, expiry: String(next.expiry) } : null,
      };
    });

    out.sort(
      (a, b) => b.outstanding - a.outstanding || a.address.localeCompare(b.address, "en-GB")
    );
    portfolioCache.set(rexUserId, { at: Date.now(), data: out });
    return out;
  })();

  const deadline = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), PORTFOLIO_DEADLINE_MS)
  );
  try {
    return await Promise.race([work, deadline]);
  } catch {
    return null;
  }
}

/* -------------------------- tenancy applications -------------------------- */

export interface ApplicationTenant {
  name: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export type ApplicationStage = "received" | "communicated" | "accepted" | "unsuccessful";

export interface AgentApplication {
  id: string;
  /** Matched REX listing (photos + a link through to My Properties). */
  listingId?: string | null;
  images?: string[];
  stage: ApplicationStage;
  status: string; // REX's own label, e.g. "Communicated"
  propertyName: string;
  locality: string;
  image: string | null;
  offer: number | null;
  offerPeriod: string | null;
  /** Rent as a % of the applicant's income — REX's own calc. Lower is safer. */
  affordability: number | null;
  dateReceived: string | null;
  startDate: string | null;
  agreementMonths: number | null;
  occupants: number | null;
  hasPets: boolean;
  tenants: ApplicationTenant[];
  notes: string | null;
  conditions: string | null;
  /** Present when the row came from Propoly — powers the progression board. */
  propoly?: {
    statusKey: string; // raw Propoly status, e.g. "references"
    holdingFee: number | null; // £
    deposit: number | null; // £
    service: string | null; // "Fully managed" | "Tenant find" | "Rent collect"
  };
  /** Portal overlay: pre-tenancy notes/stage-moves/checklist (lib/deal-store). */
  portal?: import("@/lib/types").DealPortalOverlay;
}

function stageOfStatus(id: string): ApplicationStage {
  if (id === "accepted") return "accepted";
  if (id === "unsuccessful") return "unsuccessful";
  if (id === "communicated") return "communicated";
  return "received";
}

function toApplication(r: Record<string, unknown>): AgentApplication {
  const listing = (r.listing ?? {}) as Record<string, unknown>;
  const property = (listing.property ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  const unit = str(property.adr_unit_number);
  const street = [str(property.adr_street_number), str(property.adr_street_name)]
    .filter(Boolean)
    .join(" ");
  const propertyName =
    [unit, street].filter(Boolean).join(", ") ||
    str(property.system_search_key) ||
    "Address unavailable";
  const locality = [str(property.adr_suburb_or_town), str(property.adr_postcode)]
    .filter(Boolean)
    .join(" ");

  const primary = (listing.listing_primary_image ?? {}) as Record<string, unknown>;
  const thumbs = (primary.thumbs ?? {}) as Record<string, { url?: string }>;
  const image =
    absoluteUrl(thumbs["400x300"]?.url) ?? absoluteUrl(primary.url) ?? null;

  const statusId = String(
    (r.application_status as { id?: string } | undefined)?.id ?? "received"
  );

  const related = (r.related ?? {}) as Record<string, unknown>;
  const rawTenants = Array.isArray(related.listing_application_tenants)
    ? (related.listing_application_tenants as Array<Record<string, unknown>>)
    : [];
  const tenants: ApplicationTenant[] = rawTenants.map((t) => {
    const c = (t.contact ?? {}) as Record<string, unknown>;
    return {
      name: str(c.name) ?? "Unnamed applicant",
      email: str(c.email_address),
      phone: str(c.phone_number),
      isPrimary: t.is_primary === true,
    };
  });

  return {
    id: String(r.id ?? ""),
    stage: stageOfStatus(statusId),
    status: label(r.application_status) ?? "Received",
    propertyName,
    locality,
    image,
    offer: num(r.offer_amount),
    offerPeriod: label(r.offer_amount_period),
    affordability: num(r.system_affordability_percentage),
    dateReceived: str(r.date_received),
    startDate: str(r.start_date),
    agreementMonths: num(r.agreement_length_months),
    occupants: num(r.num_of_occupants),
    hasPets: r.has_pets === true,
    tenants,
    notes: str(r.notes),
    conditions: str(r.conditions),
  };
}

/**
 * The agent's tenancy applications — their live let pipeline. Newest first.
 * Scoped by application.agent_id, so an agent only sees their own.
 * null on failure so the caller can say so rather than imply an empty pipeline.
 */
export async function getAgentApplications(
  rexUserId: string
): Promise<AgentApplication[] | null> {
  if (!rexConfigured() || !rexUserId) return null;

  const work = (async (): Promise<AgentApplication[] | null> => {
    // No capabilities probe — see getAgentListings.
    const res = await rexCall("TenancyApplications", "search", {
      criteria: [{ name: "application.agent_id", type: "=", value: rexUserId }],
      limit: COUNT_LIMIT,
    }).catch(() => null);
    if (!res || !res.ok) return null;

    return rexRows(res.result)
      .map(toApplication)
      .sort((a, b) => (b.dateReceived ?? "").localeCompare(a.dateReceived ?? ""));
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

/* ------------------------- one listing, in full ------------------------- */

/**
 * The extra detail the property drawer shows — the advert copy, the room
 * counts and the dated milestones for the activity strip. Deliberately a
 * separate call from getAgentListings: it needs a Properties read per
 * property (room counts don't ride along on a Listings search), which is
 * fine for one open drawer and far too slow across a whole grid.
 */
export interface ListingDetail {
  /** Advert body — the "About this property" copy. */
  description: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  receptions: number | null;
  ensuites: number | null;
  garages: number | null;
  propertyType: string | null;
  furnishing: string | null;
  councilTaxBand: string | null;
  deposit: number | null;
  /** Dated events for the activity strip, oldest first. */
  activity: Array<{ label: string; at: string }>;
}

const detailCache = new Map<string, { at: number; data: ListingDetail }>();
const DETAIL_TTL_MS = 5 * 60_000;

/** Unix seconds → ISO date, ignoring REX's zero/blank stamps. */
function stamp(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

export async function getListingDetail(
  listingId: string
): Promise<ListingDetail | null> {
  if (!rexConfigured() || !listingId) return null;

  const cached = detailCache.get(listingId);
  if (cached && Date.now() - cached.at < DETAIL_TTL_MS) return cached.data;

  const res = await rexCall("Listings", "search", {
    criteria: [{ name: "id", type: "=", value: listingId }],
    extra_options: { extra_fields: ["related.listing_adverts"] },
    limit: 1,
  }).catch(() => null);
  if (!res || !res.ok) return null;

  const row = rexRows(res.result)[0];
  if (!row) return null;

  const related = (row.related ?? {}) as Record<string, unknown>;
  const adverts = Array.isArray(related.listing_adverts)
    ? (related.listing_adverts as Array<Record<string, unknown>>)
    : [];
  const internet = adverts.find((a) => a.advert_type === "internet") ?? adverts[0];
  const body = typeof internet?.advert_body === "string" ? internet.advert_body : null;
  const heading =
    typeof internet?.advert_heading === "string" ? internet.advert_heading : null;

  // Room counts hang off the property record, not the listing.
  const property = (row.property ?? {}) as Record<string, unknown>;
  const propertyId = property.id ? String(property.id) : null;
  const propRes = propertyId
    ? await rexCall("Properties", "read", { id: propertyId }).catch(() => null)
    : null;
  const prop = (propRes?.ok ? propRes.result : {}) as Record<string, unknown>;

  const activity = [
    { label: "Added to portfolio", at: stamp(row.system_ctime) },
    { label: "Marked on market", at: stamp(row.system_publication_time) },
    { label: "Available from", at: (row.available_from_date as string) ?? null },
    { label: "Details updated", at: stamp(row.system_modtime) },
  ]
    .filter((e): e is { label: string; at: string } => Boolean(e.at))
    .sort((a, b) => a.at.localeCompare(b.at));

  const data: ListingDetail = {
    description: (body ?? heading)?.trim() || null,
    bedrooms: num(prop.attr_bedrooms),
    bathrooms: num(prop.attr_bathrooms),
    receptions: num(prop.attr_living_areas),
    ensuites: num(prop.attr_ensuites),
    garages: num(prop.attr_garages),
    propertyType: label(prop.property_subcategory) ?? label(prop.property_category),
    furnishing: label(row.tenancy_type) ?? label(row.let_type),
    councilTaxBand: label(prop.attr_council_tax_band),
    deposit: num(row.price_bond),
    activity,
  };

  detailCache.set(listingId, { at: Date.now(), data });
  return data;
}

/* ------------------- matching Propoly deals back to REX ------------------- */

/**
 * Propoly stores a free-text address, REX stores parts, and the two rarely
 * agree: "66 Fore Street, Kingsteignton" in one is "Room 2, 66 Fore Street,
 * Newton Abbot" in the other. Postcode is the only field both get right, so
 * we bucket by postcode and then score the candidates on the numbers and
 * street words they share.
 */
const POSTCODE = /\b([A-Z]{1,2}\d{1,2}[A-Z]?)\s?(\d[A-Z]{2})\b/;
const NOISE = new Set([
  "FLAT", "ROOM", "APARTMENT", "THE", "AND", "COURT", "HOUSE", "ROAD",
  "STREET", "AVENUE", "DRIVE", "LANE", "TERRACE", "PLACE", "WAY", "CLOSE",
]);

function postcodeOf(name: string, locality: string): string | null {
  const m = `${name} ${locality}`.toUpperCase().match(POSTCODE);
  return m ? `${m[1]}${m[2]}` : null;
}

function tokensOf(name: string): { numbers: Set<string>; words: Set<string> } {
  const upper = name.toUpperCase();
  const numbers = new Set(upper.match(/\d+[A-Z]?/g) ?? []);
  const words = new Set(
    (upper.match(/[A-Z]{3,}/g) ?? []).filter((w) => !NOISE.has(w))
  );
  return { numbers, words };
}

export interface ListingPhotoMatch {
  listingId: string;
  image: string | null;
  images: string[];
}

interface IndexedProperty extends ListingPhotoMatch {
  numbers: Set<string>;
  words: Set<string>;
}

export type PhotoIndex = Map<string, IndexedProperty[]>;

/**
 * Photos (and the listing id, so the drawer can link through to My
 * Properties) for the agent's own properties, bucketed by postcode. Covers
 * both books: what's on the market now and what they already manage.
 */
export async function getAgentPhotoIndex(rexUserId: string): Promise<PhotoIndex> {
  const [listings, portfolio] = await Promise.all([
    getAgentListings(rexUserId).catch(() => null),
    getAgentPortfolioProperties(rexUserId).catch(() => null),
  ]);

  const index: PhotoIndex = new Map();
  const add = (
    name: string,
    locality: string,
    listingId: string,
    image: string | null,
    images: string[]
  ) => {
    const pc = postcodeOf(name, locality);
    if (!pc || !image) return;
    const { numbers, words } = tokensOf(name);
    const bucket = index.get(pc) ?? [];
    bucket.push({ listingId, image, images, numbers, words });
    index.set(pc, bucket);
  };

  for (const l of listings ?? []) add(l.name, l.locality, l.id, l.image, l.images);
  for (const p of portfolio ?? []) add(p.name, p.locality, p.listingId, p.image, p.images);
  return index;
}

/** Best property in the index for one address, or null if nothing convinces. */
export function matchListingPhoto(
  index: PhotoIndex,
  name: string,
  locality: string
): ListingPhotoMatch | null {
  const pc = postcodeOf(name, locality);
  if (!pc) return null;
  const bucket = index.get(pc);
  if (!bucket?.length) return null;
  // A single property on the postcode is already the answer.
  if (bucket.length === 1) return bucket[0];

  const { numbers, words } = tokensOf(name);
  let best: IndexedProperty | null = null;
  let bestScore = 0;
  for (const cand of bucket) {
    let score = 0;
    for (const n of numbers) if (cand.numbers.has(n)) score += 2;
    for (const w of words) if (cand.words.has(w)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  // Same postcode with nothing else in common is still the same street —
  // the building photo beats no photo at all.
  return best ?? bucket[0];
}

/* --------------------------- documents in REX ---------------------------- */

/**
 * Files attached to a listing in REX — the tenancy agreements, certificates
 * and signed paperwork staff have uploaded there.
 *
 * Names and metadata only: the API exposes `search` on Documents and nothing
 * else. There is no download/read method and no REST file endpoint, and
 * Upload is one-way, so the bytes can't be fetched — the portal links back
 * to the REX record to open them. (Compliance entries carry a `file` field
 * too, but it's null across the whole account: nobody attaches the
 * certificate to the compliance record itself.)
 */
export interface RexDocument {
  id: string;
  name: string;
  /** REX's own category, e.g. "other", "agreement". */
  type: string | null;
  sizeMb: number | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
}

const docsCache = new Map<string, { at: number; data: RexDocument[] }>();
const DOCS_TTL_MS = 5 * 60_000;

export async function getListingDocuments(listingId: string): Promise<RexDocument[]> {
  if (!rexConfigured() || !listingId) return [];

  const cached = docsCache.get(listingId);
  if (cached && Date.now() - cached.at < DOCS_TTL_MS) return cached.data;

  const res = await rexCall("Documents", "search", {
    criteria: [
      { name: "primary_record_type", type: "=", value: "listing" },
      { name: "listing_id", type: "=", value: listingId },
    ],
    limit: 50,
  }).catch(() => null);
  if (!res || !res.ok) return [];

  const docs = rexRows(res.result).map((r) => {
    const by = (r.system_created_user ?? {}) as { name?: string };
    return {
      id: String(r.id ?? ""),
      name: typeof r.description === "string" ? r.description : "Document",
      type: label(r.type_id),
      sizeMb: num(r.system_size_mb),
      uploadedAt: stamp(r.system_ctime),
      uploadedBy: by.name ?? null,
    };
  });

  docsCache.set(listingId, { at: Date.now(), data: docs });
  return docs;
}

/* ----------------------- business-wide compliance ------------------------ */

export interface BusinessCompliance {
  totalItems: number;
  overdue: number;
  upcoming: number;
  valid: number;
  byType: Array<{ type: string; total: number; overdue: number; upcoming: number }>;
}

const businessComplianceCache = { at: 0, data: null as BusinessCompliance | null };
const BUSINESS_COMPLIANCE_TTL_MS = 60 * 60_000;

/**
 * Every compliance entry in REX, classified. Queried across the account in one
 * paged sweep rather than per agent: ComplianceEntries is superlinearly slow
 * on large id sets, so thirty per-agent fetches would take minutes.
 *
 * The expiry date sits inside `details` under a key named after the entry type
 * (details.epc.expiry_date, details.gas_safety.expiry_date, …), so it's read
 * generically rather than by listing every type we know about today.
 */
export async function getBusinessCompliance(): Promise<BusinessCompliance | null> {
  if (
    businessComplianceCache.data &&
    Date.now() - businessComplianceCache.at < BUSINESS_COMPLIANCE_TTL_MS
  ) {
    return businessComplianceCache.data;
  }
  if (!rexConfigured()) return null;

  // 64 pages of ComplianceEntries is the slowest walk we do, so a fresh
  // process serves the last stored result rather than re-sweeping REX.
  const { readCache, writeCache } = await import("@/lib/integration-cache");
  if (!businessComplianceCache.data) {
    const stored = await readCache<BusinessCompliance>("rex:compliance").catch(() => null);
    if (stored) {
      businessComplianceCache.at = stored.at;
      businessComplianceCache.data = stored.data;
      if (Date.now() - stored.at < BUSINESS_COMPLIANCE_TTL_MS) return stored.data;
    }
  }

  // 60 pages returned exactly 6,000 rows on the first run — i.e. the cap, not
  // the end of the data. Raised well clear of the real total, and a run that
  // still hits it returns null rather than reporting a truncated count as
  // though it were the whole account.
  const MAX_PAGES = 400;
  const rows: Array<Record<string, unknown>> = [];
  let capped = true;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await rexCall("ComplianceEntries", "search", {
      criteria: [{ name: "system_record_state", type: "=", value: "active" }],
      limit: 100,
      offset: (page - 1) * 100,
    }).catch(() => null);
    if (!res || !res.ok) break;
    const batch = rexRows(res.result);
    rows.push(...batch);
    if (batch.length < 100) {
      capped = false;
      break;
    }
  }
  if (rows.length === 0 || capped) return null;

  const UPCOMING_DAYS = 60;
  const now = Date.now();
  const byType = new Map<string, { total: number; overdue: number; upcoming: number }>();
  let overdue = 0;
  let upcoming = 0;
  let valid = 0;

  for (const r of rows) {
    const type = String(r.type_id ?? "unknown");
    // details is keyed by the entry type; pull whichever block is there.
    const details = (r.details ?? {}) as Record<string, { expiry_date?: string | null }>;
    const block = Object.values(details)[0] ?? {};
    const expiry = block.expiry_date ? Date.parse(block.expiry_date) : NaN;

    const bucket = byType.get(type) ?? { total: 0, overdue: 0, upcoming: 0 };
    bucket.total++;

    if (Number.isFinite(expiry)) {
      const days = (expiry - now) / 86_400_000;
      if (days < 0) {
        overdue++;
        bucket.overdue++;
      } else if (days <= UPCOMING_DAYS) {
        upcoming++;
        bucket.upcoming++;
      } else {
        valid++;
      }
    } else {
      // No expiry recorded — counted but not flagged either way.
      valid++;
    }
    byType.set(type, bucket);
  }

  const data: BusinessCompliance = {
    totalItems: rows.length,
    overdue,
    upcoming,
    valid,
    byType: [...byType.entries()]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.overdue - a.overdue || b.total - a.total),
  };
  businessComplianceCache.at = Date.now();
  businessComplianceCache.data = data;
  await writeCache("rex:compliance", data);
  return data;
}
