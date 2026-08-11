import "server-only";
import type { FunnelStats } from "./types";
import { rexCall, rexRows, rexConfigured, rexLettingsAgents } from "./rex";

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
    // Lettings only. A partner who also sells for TPE files both books against
    // the same Rex user id, so an unfiltered count puts their sales
    // appraisals in their lettings MA figure.
    const lettingsRows = recordedRows.filter(isLettingsAppraisal);

    const recorded: AgentAppraisal[] = lettingsRows.map((r) => ({
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
      // Lettings appraisals only — a same-month SALE appraisal doesn't mean the
      // property had a lettings MA, so the instruction must still count.
      const withMa = new Set(overlap.filter(isLettingsAppraisal).map(propertyIdOf));
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

/**
 * Is this appraisal a LETTINGS appraisal?
 *
 * Rex stamps every appraisal with `appraisal_type` — "sale" or "rent". This
 * became load-bearing on 10 Aug 2026, when the lettings-agent list widened to
 * include TLE partners filed under @thepropertyexperts.co.uk addresses (see
 * rexLettingsAgents). Several of them sell for TPE as well, so their Rex user
 * id now carries both books: counting every appraisal against their id would
 * have put 6 of June's sales appraisals and 4 of July's into the lettings MA
 * figure.
 *
 * Measured on the same day, this ALSO corrects an existing over-count on the
 * narrow list — June's 7 "market appraisals" were only 4 lettings appraisals
 * and 3 sales ones. The old number was wrong in both directions at once.
 *
 * Unknown/absent types are excluded: an appraisal Rex won't classify is not
 * evidence of lettings work, and guessing inflates the headline figure.
 */
function isLettingsAppraisal(r: Record<string, unknown>): boolean {
  const t = r.appraisal_type as { id?: string } | string | null;
  const id = typeof t === "object" && t ? t.id : t;
  return String(id ?? "").toLowerCase() === "rent";
}

export async function getBusinessMonthCounts(
  month: string,
  agentIds: string[],
  force = false
): Promise<BusinessMonthCounts | null> {
  if (!rexConfigured() || agentIds.length === 0) return null;
  const range = monthRange(month);
  if (!range) return null;

  // Keyed on the AGENT LIST as well as the month. It used to be month alone,
  // which meant a caller passing a different set of agents got served another
  // caller's figures — and force=true skipped the read but still wrote, so a
  // forced refresh poisoned the cache for everyone else. Harmless while every
  // caller passed rexLettingsAgents(), and a live hazard the moment that list
  // changed (it just did) or a per-office variant appears.
  const cacheKey = `${month}:${[...agentIds].sort().join(",")}`;
  const cached = monthCountsCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < MONTH_COUNTS_TTL_MS) return cached.data;

  const work = (async (): Promise<BusinessMonthCounts | null> => {
    const [applications, appraisalRows, listingRows, viewingRows] = await Promise.all([
      countSearch("TenancyApplications", [
        { name: "application.agent_id", type: "in", value: agentIds },
        { name: "application.date_accepted", type: ">=", value: range.start },
        { name: "application.date_accepted", type: "<=", value: range.end },
      ]),
      // Rows, not a count — the lettings/sale split is only visible per row,
      // and counting first would count both books.
      pagedSearch("Appraisals", [
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

    // Lettings appraisals only — see isLettingsAppraisal. On the widened agent
    // list this is what separates a partner's lettings book from their sales
    // one; on the old narrow list it also removes sales appraisals that were
    // being counted as MAs.
    const marketAppraisals = appraisalRows ? appraisalRows.filter(isLettingsAppraisal).length : null;

    // Combined MAs (Susan's definition): recorded appraisals + this month's
    // listings whose property has NO same-month recorded appraisal.
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
          // Same lettings-only test as above. A property whose only same-month
          // appraisal was a SALE appraisal has not had a lettings MA, so it
          // must still count as listing-only — otherwise widening the agent
          // list would quietly SUPPRESS instructions from the combined figure.
          const withMa = new Set(
            overlapRows
              .filter(isLettingsAppraisal)
              .map((r) => String(((r.property as { id?: unknown }) ?? {}).id ?? ""))
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
    monthCountsCache.set(cacheKey, { at: Date.now(), data });
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
      // Rows not a count, so sales appraisals can be excluded per row.
      pagedSearch("Appraisals", [
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
    const mas = maCount ? maCount.filter(isLettingsAppraisal).length : null;
    if (mas == null && listings == null) return null;
    return { marketAppraisals: mas, listings };
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
  /**
   * The listing agent REX has on the record. Carried so a business-wide walk
   * can attribute anything that hangs off a property — compliance especially —
   * to a partner WITHOUT one search per agent. Null when REX holds none.
   */
  agentId: string | null;
  agentName: string | null;
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
    agentId: (() => {
      const a = (r.listing_agent_1 ?? {}) as { id?: unknown };
      return a.id == null ? null : String(a.id);
    })(),
    agentName: (() => {
      const a = (r.listing_agent_1 ?? {}) as { name?: unknown };
      return typeof a.name === "string" && a.name.trim() ? a.name.trim() : null;
    })(),
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
//
// These 14 ids started as a sample. They are now VERIFIED: a full census of the
// live account on 31 Jul 2026 (6,397 entries, every page walked) found exactly
// 20 distinct type_ids — these 14 plus six contact-level ones (contact_id_check,
// contact_proof_of_address, contact_aml_check, contact_nrl, contact_right_to_rent,
// contact_referencing_certificate) that belong to the different job above. So
// there is no property certificate type going unrecognised, and no spelling
// mismatch — the US "license" spelling below is REX's own. Counts, for scale:
// epc 2939, terms_of_business 420, listing_proof_of_ownership 239, gas_safety
// 136, eicr 125, oil_safety 107, the three hmo_license ids 80/68/62.
//
// Anything REX returns that isn't here is still DROPPED, and a dropped type used
// to be indistinguishable from a compliant one. It no longer is: unrecognised
// ids are collected per property (`unmapped`) and listed by
// /api/my/compliance-debug, which is how this list gets extended if REX's
// configuration ever grows a new one.
export const PROPERTY_COMPLIANCE: Record<string, string> = {
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
  /** REX's issue_date, verbatim. Read for years, only now passed on. */
  issued: string | null;
  expiry: string | null;
  notes: string | null;
  /**
   * REX gave an expiry string we can't read as a date. The state is forced to
   * "missing" so a human looks: NaN comparisons are all false, so an unreadable
   * date used to fall out of the days<0 / days<=60 chain as "valid" — the worst
   * possible answer, a certificate passing on a date nobody could parse.
   */
  dateUnparsed?: boolean;
  /**
   * Where the item came from. Absent = a ComplianceEntry, the normal case.
   * "listing-field" = synthesised from the listing's own epc_expiry_date
   * because no EPC ComplianceEntry existed — 74.8% of rentals carry the field
   * (census 2 Aug 2026) while ComplianceEntries has the known REX discrepancy,
   * so the field fills the gap rather than leaving "missing".
   */
  source?: "listing-field";
  /**
   * Both sources exist and DISAGREE on the expiry date. The ComplianceEntry
   * stays authoritative; this carries the listing field's date so the page can
   * say "the listing says 2031-04-02" and someone can fix whichever is wrong —
   * the exact discrepancy that blocks automated EPC reminders today.
   */
  conflictingFieldExpiry?: string | null;
  /**
   * This row is a GAP we added, not a record REX holds: the property is
   * expected to carry this certificate and doesn't. There is no entry behind
   * it, so there is nothing to open and nothing to remind against — the page
   * has to say "add this", not "renew this".
   */
  required?: boolean;
  /**
   * REX's id for this entry, so the page can link at the document through
   * /api/compliance/document without ever handling the file URL itself.
   */
  entryId?: string;
  /**
   * Is the actual certificate attached, as opposed to merely a record that one
   * exists? These are very different things and the gap is the point: censused
   * 3 Aug 2026, EICR / terms of business / proof of ownership are attached ~100%
   * of the time, gas safety 66%, and EPC and tenant ID checks essentially never.
   *
   * The URL itself is deliberately NOT carried. REX serves these from two
   * hosts: one signs with `exp`+`sig` (2-hour lifetime, so it can't be held in
   * a durable cache), the other is entirely unsigned — the URL IS the
   * credential and must never reach a browser. Resolving it server-side per
   * request, via /api/compliance/document, handles both.
   */
  hasDocument?: boolean;
}

export interface PropertyCompliance {
  listingId: string;
  name: string;
  locality: string;
  image: string | null;
  items: ComplianceItem[];
  /** How many items need a human — drives the "needs attention" sort. */
  outstanding: number;
  /**
   * Did REX give us a COMPLETE answer for this property? False when its chunk
   * failed or hit the row cap. An empty `items` with checked=false means "we
   * don't know", which must never render as "all clear" — that is the whole
   * reason this flag exists.
   */
  checked: boolean;
  /**
   * Raw type_ids REX holds against this property that PROPERTY_COMPLIANCE
   * doesn't recognise, so they were dropped before the agent saw them.
   */
  unmapped: string[];
}

const EXPIRING_DAYS = 60;

/**
 * What a rented property is expected to hold, so the page can report what ISN'T
 * there. Until now it could only list records that existed, which meant a
 * property with no gas safety record at all looked identical to one that didn't
 * need one.
 *
 * The baseline is James's (3 Aug 2026): EPC, gas safety, electrical. His full
 * written list is in Apple Notes, which macOS won't let this process read — so
 * these are the stated minimum and are meant to be edited once that list lands.
 *
 * Worth knowing when you revisit: smoke and CO alarms are a legal requirement
 * in ALL rented homes in England (Smoke and Carbon Monoxide Alarm (England)
 * Regulations 2015, amended 2022), not just HMOs. They are deliberately NOT in
 * the baseline here because that was not the instruction, and adding them would
 * put two fresh gaps on ~1,100 properties overnight. That is a policy call, not
 * a code one.
 */
const REQUIRED_BASELINE = ["epc", "gas_safety", "eicr"] as const;

/**
 * Extra certificates an HMO carries. Derived from the book rather than assumed:
 * of the 81 properties holding 6+ compliance types, 75 (93%) are HMO-licensed,
 * and these are the types they hold. Non-HMOs essentially never do.
 */
const REQUIRED_HMO_EXTRA = [
  "smoke_alarms",
  "co_alarms",
  "emergency_lighting_fire_exit",
  "portable_appliance_testing",
  "legionella_risk_assessment",
] as const;

const HMO_LICENCE_TYPES = new Set([
  "mandatory_hmo_license",
  "additional_hmo_license",
  "selective_hmo_license",
]);

/**
 * Add a "nothing on file" row for each certificate the property ought to have
 * and doesn't.
 *
 * Two deliberate refusals:
 *
 *  • Nothing is added when REX's answer was incomplete. "We couldn't read this
 *    property" must never render as "three certificates are missing" — that is
 *    a fabricated gap, and it would send someone chasing a landlord for a
 *    certificate that is sitting in REX.
 *  • Gas is not demanded of a property that holds an OIL safety record. 106
 *    properties in the book are oil-heated; insisting on a gas certificate for
 *    a house with no gas supply is exactly the kind of false alarm that teaches
 *    people to ignore the page.
 */
function addMissingRequired(
  items: ComplianceItem[],
  checked: boolean
): ComplianceItem[] {
  if (!checked) return items;

  const held = new Set(items.map((i) => i.type));
  const isHmo = items.some((i) => HMO_LICENCE_TYPES.has(i.type));
  const oilHeated = held.has("oil_safety");

  const required = [
    ...REQUIRED_BASELINE,
    ...(isHmo ? REQUIRED_HMO_EXTRA : []),
  ].filter((t) => !(t === "gas_safety" && oilHeated));

  const gaps: ComplianceItem[] = required
    .filter((t) => !held.has(t))
    .map((t) => ({
      type: t,
      label: PROPERTY_COMPLIANCE[t] ?? t,
      state: "missing" as ComplianceState,
      issued: null,
      expiry: null,
      notes: null,
      required: true,
    }));

  return gaps.length ? [...items, ...gaps].sort((a, b) => a.label.localeCompare(b.label)) : items;
}

/**
 * Fold the listing's own EPC fields into a property's compliance items.
 *
 * Precedence is deliberate: a ComplianceEntry EPC always wins, because that is
 * the record staff maintain. The listing field only (a) fills a hole where no
 * entry exists, or (b) annotates an entry whose date it contradicts. It never
 * silently overrides.
 */
function reconcileEpcField(
  items: ComplianceItem[],
  epcExpiry: string | null,
  epcNotRequired: boolean
): ComplianceItem[] {
  // Guard the census-found garbage: one live listing expires in "3033", and a
  // handful predate 2000. Out-of-range = no field, not a far-future pass.
  const year = Number((epcExpiry ?? "").slice(0, 4));
  const fieldExpiry =
    epcExpiry && year >= 2000 && year <= 2100 ? epcExpiry : null;

  const entry = items.find((i) => i.type === "epc");
  if (entry) {
    if (
      fieldExpiry &&
      entry.expiry &&
      !entry.dateUnparsed &&
      entry.expiry.slice(0, 10) !== fieldExpiry.slice(0, 10)
    ) {
      return items.map((i) =>
        i.type === "epc" ? { ...i, conflictingFieldExpiry: fieldExpiry } : i
      );
    }
    return items;
  }

  if (!fieldExpiry && !epcNotRequired) return items;
  // NaN comparisons are all false, so an unreadable date would slide through
  // days<0 / days<=60 to "valid" — the exact failure complianceStateOf guards
  // against for ComplianceEntries, reintroduced here until the review caught
  // it. Unparseable = missing + dateUnparsed, so a human looks.
  const t = fieldExpiry ? new Date(fieldExpiry).getTime() : NaN;
  const unparsed = fieldExpiry != null && !Number.isFinite(t);
  const days = Number.isFinite(t) ? Math.round((t - Date.now()) / 86_400_000) : null;
  const state: ComplianceState = epcNotRequired
    ? "not-required"
    : days == null
      ? "missing"
      : days < 0
        ? "expired"
        : days <= EXPIRING_DAYS
          ? "expiring"
          : "valid";
  return [
    ...items,
    {
      type: "epc",
      label: "EPC",
      state,
      issued: null,
      expiry: fieldExpiry,
      notes: null,
      source: "listing-field" as const,
      ...(unparsed ? { dateUnparsed: true } : {}),
    },
  ].sort((a, b) => a.label.localeCompare(b.label));
}

export function complianceNeedsWork(s: ComplianceState): boolean {
  return s === "expired" || s === "expiring" || s === "missing";
}

/**
 * The block inside `details` that holds the dates:
 *   { notes, issue_date, expiry_date, not_required }
 *
 * `details` is keyed by the entry's SCHEMA GROUP id, which is usually but NOT
 * always the type_id. Censused against the live account 31 Jul 2026: 13 of our
 * 14 property types key on themselves, and one does not —
 *   type_id "listing_proof_of_ownership" → details.proof_of_ownership
 * All 239 of those carry an issue_date, and indexing on type_id alone returned
 * {} for every one, so all 239 read as "Nothing on file" and counted against
 * the property. A certificate that exists in REX, reported as absent.
 *
 * Every entry in the account carries exactly one block, so the sole block is the
 * fallback. Two blocks and no type match gets nothing rather than a guess:
 * dating a certificate from the wrong block is worse than admitting we can't.
 */
function complianceDetailKey(details: Record<string, unknown>, type: string): string | null {
  const byType = details[type];
  if (byType && typeof byType === "object") return type;
  const keys = Object.keys(details);
  if (keys.length === 1 && details[keys[0]] && typeof details[keys[0]] === "object") {
    return keys[0];
  }
  return null;
}

function complianceDetailBlock(
  details: Record<string, unknown>,
  type: string
): Record<string, unknown> {
  const key = complianceDetailKey(details, type);
  return key ? (details[key] as Record<string, unknown>) : {};
}

/**
 * Dates come back as whatever string REX stored; nothing is normalised here, so
 * the caller sees exactly what REX said.
 */
/**
 * The attached certificate, if there is one.
 *
 * `file` is an OBJECT ({ uri, url }), not a scalar — testing `entry.file` for
 * truthiness reads as "always present" and hid this field for weeks. The url is
 * protocol-relative (`//host/...`).
 */
/**
 * REX's internal file URI → a fetchable URL.
 *
 * Derived 3 Aug 2026 by comparing `file.uri` against `file.url` on compliance
 * entries, which carry both:
 *
 *   rexlive://3517/compliance_entries/814499/files/x.pdf
 *     → https://uk-crm.cdns.rexsoftware.com/app/livestore/accounts/3517/…/x.pdf
 *
 * This is what makes documents on a LISTING reachable: `documents/search`
 * returns only a `uri`, never a `url`, so without this mapping the file could
 * be listed but not opened — which is exactly what the portal used to say.
 *
 * `rexpm://` (files that originated in Rex PM) is deliberately NOT derived: it
 * resolves to a file-proxy URL carrying an `exp`/`sig` signature we cannot
 * generate. Those only work when REX hands us the signed `url` itself.
 */
export function rexUriToUrl(uri: unknown): string | null {
  if (typeof uri !== "string") return null;
  const PREFIX = "rexlive://";
  if (!uri.startsWith(PREFIX)) return null;
  const rest = uri.slice(PREFIX.length);
  if (!rest || rest.includes("..")) return null;
  return `https://uk-crm.cdns.rexsoftware.com/app/livestore/accounts/${rest}`;
}

export function complianceFileUrl(entry: Record<string, unknown>): string | null {
  const file = entry.file;
  if (!file || typeof file !== "object") return null;
  const raw = (file as Record<string, unknown>).url;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.startsWith("//") ? `https:${raw}` : raw;
}

function readComplianceEntry(entry: Record<string, unknown>) {
  const type = String(label(entry.type_id) ?? "");
  const details = (entry.details ?? {}) as Record<string, unknown>;
  const d = complianceDetailBlock(details, type);
  return {
    type,
    id: entry.id != null ? String(entry.id) : null,
    hasDocument: complianceFileUrl(entry) != null,
    detailsKeys: Object.keys(details),
    blockKey: complianceDetailKey(details, type),
    expiry: typeof d.expiry_date === "string" && d.expiry_date ? d.expiry_date : null,
    issued: typeof d.issue_date === "string" && d.issue_date ? d.issue_date : null,
    notes: typeof d.notes === "string" && d.notes.trim() ? d.notes.trim() : null,
    notRequired: d.not_required,
  };
}

/**
 * `not_required` is an explicit answer ("No gas in building"), not a gap — so
 * it's never outstanding. A record with no dates at all is genuinely
 * incomplete; one with an issue_date but no expiry simply doesn't expire. An
 * expiry we can't parse is treated as incomplete, NOT as valid.
 */
function complianceStateOf(
  expiry: string | null,
  issued: string | null,
  notRequired: unknown
): { state: ComplianceState; days: number | null; unparsed: boolean } {
  if (notRequired === true) return { state: "not-required", days: null, unparsed: false };
  if (expiry) {
    const t = new Date(expiry).getTime();
    // Guard the parse. Every comparison against NaN is false, so an unreadable
    // date used to slide past both the "expired" and "expiring" tests and land
    // on valid — a silent false pass on the one page that must not have any.
    if (!Number.isFinite(t)) return { state: "missing", days: null, unparsed: true };
    const days = Math.round((t - Date.now()) / 86_400_000);
    return {
      state: days < 0 ? "expired" : days <= EXPIRING_DAYS ? "expiring" : "valid",
      days,
      unparsed: false,
    };
  }
  if (issued) return { state: "valid", days: null, unparsed: false }; // doesn't expire
  return { state: "missing", days: null, unparsed: false };
}

function toComplianceItem(entry: Record<string, unknown>): ComplianceItem | null {
  const raw = readComplianceEntry(entry);
  const name = PROPERTY_COMPLIANCE[raw.type];
  if (!name) return null; // unrecognised type — the caller records it, see below

  const { state, unparsed } = complianceStateOf(raw.expiry, raw.issued, raw.notRequired);
  return {
    type: raw.type,
    label: name,
    state,
    issued: raw.issued,
    expiry: raw.expiry,
    notes: raw.notes,
    ...(unparsed ? { dateUnparsed: true } : {}),
    ...(raw.id ? { entryId: raw.id } : {}),
    ...(raw.hasDocument ? { hasDocument: true } : {}),
  };
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
// keep each call fast and under the cap.
const COMPLIANCE_CHUNK = 10;
// 10 parents can genuinely exceed one page — a property holds up to 14 types
// against BOTH its property and listing record, so ~5 properties per chunk can
// reach 100+ rows. Page until a page comes back short; a chunk still full at
// the ceiling is reported as unchecked rather than quietly cut off.
const COMPLIANCE_MAX_PAGES = 5;

interface ComplianceFetch {
  byParent: Map<string, ComplianceItem[]>;
  /** Parent ids REX did NOT give a complete answer for — cap hit, or the call failed. */
  unchecked: Set<string>;
  /** Raw type_ids REX returned that PROPERTY_COMPLIANCE doesn't know, per parent. */
  unmappedByParent: Map<string, Set<string>>;
}

/**
 * Compliance entries for a set of property/listing ids.
 *
 * The old version asked for 100 rows per chunk with no paging and skipped any
 * chunk that errored, so a capped or failed chunk left its properties with an
 * empty item list — which the page then printed as ALL CLEAR. Anything we
 * couldn't fully read now comes back named in `unchecked`, and the caller is
 * expected to say so on screen. Losing items is survivable; claiming a property
 * is compliant because we didn't finish reading it is not.
 */
async function fetchComplianceByParent(ids: string[]): Promise<ComplianceFetch> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += COMPLIANCE_CHUNK) {
    chunks.push(ids.slice(i, i + COMPLIANCE_CHUNK));
  }

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const rows: Array<Record<string, unknown>> = [];
      for (let page = 0; page < COMPLIANCE_MAX_PAGES; page++) {
        const res = await rexCall("ComplianceEntries", "search", {
          criteria: [{ name: "parent_object_id", type: "in", value: chunk }],
          limit: COUNT_LIMIT,
          offset: page * COUNT_LIMIT,
        }).catch(() => null);
        // Keep whatever earlier pages gave us, but the answer is incomplete.
        if (!res || !res.ok) return { chunk, rows, complete: false };
        const batch = rexRows(res.result);
        rows.push(...batch);
        if (batch.length < COUNT_LIMIT) return { chunk, rows, complete: true };
      }
      return { chunk, rows, complete: false }; // still full at the ceiling
    })
  );

  const byParent = new Map<string, ComplianceItem[]>();
  const unchecked = new Set<string>();
  const unmappedByParent = new Map<string, Set<string>>();

  for (const { chunk, rows, complete } of results) {
    if (!complete) for (const id of chunk) unchecked.add(id);
    for (const row of rows) {
      const parent = String(row.parent_object_id ?? "");
      if (!parent) continue;
      const item = toComplianceItem(row);
      if (!item) {
        // We only ask about property and listing ids, so this isn't a
        // contact-level check — it's a property certificate type nobody has
        // added to PROPERTY_COMPLIANCE. Carried through instead of vanishing.
        const type = String(label(row.type_id) ?? "").trim();
        if (type) {
          const seen = unmappedByParent.get(parent) ?? new Set<string>();
          seen.add(type);
          unmappedByParent.set(parent, seen);
        }
        continue;
      }
      const list = byParent.get(parent) ?? [];
      list.push(item);
      byParent.set(parent, list);
    }
  }
  return { byParent, unchecked, unmappedByParent };
}

function dedupeComplianceItems(items: ComplianceItem[]): ComplianceItem[] {
  const byType = new Map<string, ComplianceItem>();
  for (const item of items) {
    const seen = byType.get(item.type);
    const sameUrgency = seen && STATE_URGENCY[item.state] === STATE_URGENCY[seen.state];
    const sameExpiry = seen && String(item.expiry ?? "") === String(seen.expiry ?? "");
    if (
      !seen ||
      STATE_URGENCY[item.state] > STATE_URGENCY[seen.state] ||
      (sameUrgency && String(item.expiry ?? "") > String(seen.expiry ?? "")) ||
      // Identical urgency AND date: prefer whichever actually has the
      // certificate attached, otherwise the survivor is just whichever REX
      // happened to return first and the page can report "no certificate"
      // for a property that has one.
      (sameUrgency && sameExpiry && !!item.hasDocument && !seen.hasDocument)
    ) {
      byType.set(item.type, item);
    }
  }
  return [...byType.values()];
}

const COMPLIANCE_TTL_MS = 60_000;
// Paging past the row cap can cost an extra round-trip per chunk, and losing
// the race returns null — "Couldn't reach REX just now" on a page that used to
// load. A little more headroom than the shared 8s budget buys the honest read.
const COMPLIANCE_DEADLINE_MS = 12_000;
const complianceCache = new Map<string, { at: number; data: PropertyCompliance[] }>();

/**
 * The agent's properties with their compliance, worst first. Live from REX.
 * null on failure so the caller can say so rather than imply all-clear.
 * Short-cached per agent — the join costs several REX round-trips.
 */
/** Compliance for one property, as Kirstie's board needs it. */
export interface DealCompliance {
  /** Worst state across the property, for the chip. */
  outstanding: number;
  expired: number;
  /** Labels of everything not in order, for the tooltip. */
  problems: string[];
  /** False when REX's answer was cut short — the board must say so, not imply clear. */
  checked: boolean;
}

/**
 * Compliance for an arbitrary set of REX listings, keyed by listing id.
 *
 * Kirstie's board is business-wide and Propoly-sourced, so the agent-scoped
 * getAgentCompliance can't serve it, and getBusinessCompliance is aggregate
 * only. This sits between them: a chunked read for exactly the listings on
 * screen.
 *
 * Applies the same required-set pass as everywhere else, so a property missing
 * a gas certificate reads as outstanding here too — the board is the last place
 * anyone looks before a tenancy starts, which makes it the most important
 * place for a gap to be visible.
 */
export async function getComplianceForListings(
  listingIds: string[]
): Promise<Map<string, DealCompliance>> {
  const out = new Map<string, DealCompliance>();
  const ids = [...new Set(listingIds.filter(Boolean).map(String))];
  if (!rexConfigured() || ids.length === 0) return out;

  const { byParent, unchecked } = await fetchComplianceByParent(ids);

  for (const id of ids) {
    const checked = !unchecked.has(id);
    const items = addMissingRequired(byParent.get(id) ?? [], checked);
    // A property REX never answered for is reported as unchecked with nothing
    // else filled in — an empty problem list must not be mistaken for "clear".
    const problems = items.filter(
      (i) => complianceNeedsWork(i.state) || i.conflictingFieldExpiry
    );
    out.set(id, {
      outstanding: problems.length,
      expired: problems.filter((i) => i.state === "expired").length,
      problems: problems.map((i) => i.label),
      checked,
    });
  }
  return out;
}

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

    const { byParent, unchecked, unmappedByParent } = await fetchComplianceByParent(ids);

    const out = listings.map((l) => {
      // Computed BEFORE the gap pass, which must not run on a property we only
      // half-read: "couldn't check" turning into "three missing" is a
      // fabricated gap someone would go and chase.
      const checked = !unchecked.has(l.propertyId) && !unchecked.has(l.id);
      const items = addMissingRequired(
        reconcileEpcField(
          dedupeComplianceItems([
            ...(byParent.get(l.propertyId) ?? []),
            ...(byParent.get(l.id) ?? []),
          ]).sort((a, b) => a.label.localeCompare(b.label)),
          l.epcExpiry,
          l.epcNotRequired
        ),
        checked
      );
      return {
        listingId: l.id,
        name: l.name,
        locality: l.locality,
        image: l.image,
        items,
        // A conflicted EPC counts as outstanding even when both dates are in
        // the future — two sources disagreeing IS the work item.
        outstanding: items.filter(
          (i) => complianceNeedsWork(i.state) || i.conflictingFieldExpiry
        ).length,
        checked,
        unmapped: [
          ...new Set([
            ...(unmappedByParent.get(l.propertyId) ?? []),
            ...(unmappedByParent.get(l.id) ?? []),
          ]),
        ].sort(),
      };
    });

    // Worst first — this page exists to surface what needs doing. Properties we
    // couldn't finish reading lead, ahead of any known problem: an unanswered
    // question outranks a known one.
    out.sort(
      (a, b) =>
        Number(a.checked) - Number(b.checked) ||
        b.outstanding - a.outstanding ||
        a.name.localeCompare(b.name, "en-GB")
    );
    complianceCache.set(rexUserId, { at: Date.now(), data: out });
    return out;
  })();

  const deadline = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), COMPLIANCE_DEADLINE_MS)
  );
  try {
    return await Promise.race([work, deadline]);
  } catch {
    return null;
  }
}

/* -------------------- compliance diagnostic (slow, honest) -------------------- */

// Everything below exists for /api/my/compliance-debug and nothing else. The
// pages trade completeness for speed — batched ids, one page, no cap check —
// and this is how we measure what that trade costs against the live account
// instead of arguing about it. It shares readComplianceEntry/complianceStateOf
// with production on purpose: a probe that parses differently proves nothing.

/** One ComplianceEntry as REX sent it, beside the values the UI would derive. */
export interface ComplianceProbeRow {
  id: string;
  parentObjectId: string;
  /** Verbatim, before label() flattens a REX lookup to a string. */
  typeIdRaw: unknown;
  /** What the parser keys on — both details[type] and PROPERTY_COMPLIANCE[type]. */
  typeId: string;
  /** False = the portal drops this entry before anyone sees it. */
  mapped: boolean;
  recordState: string | null;
  /** Proves whether details really is keyed by the entry type, and single-keyed. */
  detailsKeys: string[];
  /** Which block the dates were actually read from. null = none, so no dates. */
  detailsBlockRead: string | null;
  /** Raw strings. Nothing is parsed or reformatted on the way out. */
  issueDate: string | null;
  expiryDate: string | null;
  notRequired: unknown;
  notes: string | null;
  /** Recorded as null account-wide (see getListingDocuments) — this is the check. */
  file: unknown;
  createdAt: string | null;
  /** What the tile would say. "valid" with expiryParses:false is a false pass. */
  derivedState: ComplianceState;
  daysToExpiry: number | null;
  /** null = no expiry recorded at all; false = REX gave a date we can't read. */
  expiryParses: boolean | null;
}

export interface ComplianceProbeParent {
  parentId: string;
  rowsReturned: number;
  pages: number;
  /** Still a full page at the ceiling — there is more we never saw. */
  capped: boolean;
  /** REX refused or timed out part-way through. */
  failed: boolean;
}

export interface ComplianceProbe {
  perParent: ComplianceProbeParent[];
  rows: ComplianceProbeRow[];
  /**
   * The same question asked the way the pages used to ask it — 10 ids, one
   * page, no offset. The gap against the per-id walk IS the truncation, in rows.
   */
  productionShape: {
    chunkSize: number;
    limit: number;
    chunks: Array<{ ids: string[]; rowsReturned: number; capped: boolean; failed: boolean }>;
    chunkRowsReturned: number;
    perIdRowsReturned: number;
    entriesLost: number;
  };
}

// One parent at a time, so the row cap can only bite on a single enormous
// property — and paging catches even that.
const PROBE_PAGE_CEILING = 20;
// REX slows superlinearly with concurrency as well as id count; six at a time
// keeps a book-wide sweep inside the route's maxDuration.
const PROBE_CONCURRENCY = 6;

function toProbeRow(entry: Record<string, unknown>): ComplianceProbeRow {
  const raw = readComplianceEntry(entry);
  const { state, days, unparsed } = complianceStateOf(raw.expiry, raw.issued, raw.notRequired);
  return {
    id: String(entry.id ?? ""),
    parentObjectId: String(entry.parent_object_id ?? ""),
    typeIdRaw: entry.type_id ?? null,
    typeId: raw.type,
    mapped: !!PROPERTY_COMPLIANCE[raw.type],
    recordState: label(entry.system_record_state),
    detailsKeys: raw.detailsKeys,
    detailsBlockRead: raw.blockKey,
    issueDate: raw.issued,
    expiryDate: raw.expiry,
    notRequired: raw.notRequired ?? null,
    notes: raw.notes,
    file: entry.file ?? null,
    createdAt: stamp(entry.system_ctime),
    derivedState: state,
    daysToExpiry: days,
    expiryParses: raw.expiry ? !unparsed : null,
  };
}

async function probeOneParent(
  parentId: string
): Promise<{ parent: ComplianceProbeParent; rows: Array<Record<string, unknown>> }> {
  const rows: Array<Record<string, unknown>> = [];
  for (let page = 0; page < PROBE_PAGE_CEILING; page++) {
    const res = await rexCall("ComplianceEntries", "search", {
      criteria: [{ name: "parent_object_id", type: "in", value: [parentId] }],
      limit: COUNT_LIMIT,
      offset: page * COUNT_LIMIT,
    }).catch(() => null);
    const pages = page + 1;
    if (!res || !res.ok) {
      return { parent: { parentId, rowsReturned: rows.length, pages, capped: false, failed: true }, rows };
    }
    const batch = rexRows(res.result);
    rows.push(...batch);
    if (batch.length < COUNT_LIMIT) {
      return { parent: { parentId, rowsReturned: rows.length, pages, capped: false, failed: false }, rows };
    }
  }
  return {
    parent: { parentId, rowsReturned: rows.length, pages: PROBE_PAGE_CEILING, capped: true, failed: false },
    rows,
  };
}

/**
 * Read every compliance entry on these parent ids twice: once per id with full
 * offset paging (the truth), once in the shape the pages use (the measurement).
 * Deliberately slow — never call this from a page.
 */
export async function probeCompliance(ids: string[]): Promise<ComplianceProbe> {
  const parents: ComplianceProbeParent[] = [];
  const rawRows: Array<Record<string, unknown>> = [];

  for (let i = 0; i < ids.length; i += PROBE_CONCURRENCY) {
    const wave = await Promise.all(ids.slice(i, i + PROBE_CONCURRENCY).map(probeOneParent));
    for (const { parent, rows } of wave) {
      parents.push(parent);
      rawRows.push(...rows);
    }
  }

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += COMPLIANCE_CHUNK) {
    chunks.push(ids.slice(i, i + COMPLIANCE_CHUNK));
  }
  const shaped = await Promise.all(
    chunks.map(async (chunk) => {
      const res = await rexCall("ComplianceEntries", "search", {
        criteria: [{ name: "parent_object_id", type: "in", value: chunk }],
        limit: COUNT_LIMIT, // no offset — this is the old shape, faults and all
      }).catch(() => null);
      if (!res || !res.ok) {
        return { ids: chunk, rowsReturned: 0, capped: false, failed: true };
      }
      const n = rexRows(res.result).length;
      return { ids: chunk, rowsReturned: n, capped: n >= COUNT_LIMIT, failed: false };
    })
  );

  const chunkRowsReturned = shaped.reduce((t, c) => t + c.rowsReturned, 0);
  return {
    perParent: parents,
    rows: rawRows.map(toProbeRow),
    productionShape: {
      chunkSize: COMPLIANCE_CHUNK,
      limit: COUNT_LIMIT,
      chunks: shaped,
      chunkRowsReturned,
      perIdRowsReturned: rawRows.length,
      entriesLost: Math.max(0, rawRows.length - chunkRowsReturned),
    },
  };
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
  /** False when REX's answer for this property was cut short — see PropertyCompliance. */
  checked: boolean;
  /** Raw REX type_ids dropped because PROPERTY_COMPLIANCE doesn't know them. */
  unmapped: string[];
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
    const { byParent, unchecked, unmappedByParent } = await fetchComplianceByParent(ids);

    const out: PortfolioProperty[] = listings.map(({ base: l, sinceISO }) => {
      const checked = !unchecked.has(l.propertyId) && !unchecked.has(l.id);
      const items = addMissingRequired(
        reconcileEpcField(
          dedupeComplianceItems([
            ...(byParent.get(l.propertyId) ?? []),
            ...(byParent.get(l.id) ?? []),
          ]).sort((a, b) => a.label.localeCompare(b.label)),
          l.epcExpiry,
          l.epcNotRequired
        ),
        checked
      );

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
        // A conflicted EPC counts as outstanding even when both dates are in
        // the future — two sources disagreeing IS the work item.
        outstanding: items.filter(
          (i) => complianceNeedsWork(i.state) || i.conflictingFieldExpiry
        ).length,
        nextRenewal: next ? { label: next.label, expiry: String(next.expiry) } : null,
        checked,
        unmapped: [
          ...new Set([
            ...(unmappedByParent.get(l.propertyId) ?? []),
            ...(unmappedByParent.get(l.id) ?? []),
          ]),
        ].sort(),
      };
    });

    // Worst first, and properties we couldn't finish reading lead the lot —
    // same order as compliance: an unanswered question outranks a known one.
    out.sort(
      (a, b) =>
        Number(a.checked) - Number(b.checked) ||
        b.outstanding - a.outstanding ||
        a.address.localeCompare(b.address, "en-GB")
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
  /**
   * The offer's own timeline, which REX has always held and the portal has
   * always thrown away. `date_communicated` is on 94% of applications,
   * `date_accepted` 38%, `date_unsuccessful` 27% — between them they answer
   * "how long does a deal take, and where does it stick", which nothing else
   * in the stack can.
   *
   * PARTIAL BY NATURE: measured 3 Aug 2026, only ~40% of 2026 Propoly deals
   * have a REX application behind them, so this covers roughly two deals in
   * five — the ones where the agent recorded the offer in REX. Anything built
   * on it has to say so rather than present it as the whole book.
   */
  dateCommunicated: string | null;
  dateAccepted: string | null;
  dateUnsuccessful: string | null;
  /** Days from the offer landing to it reaching the landlord. */
  daysToLandlord: number | null;
  /** Days from the landlord seeing it to them deciding, either way. */
  daysToDecision: number | null;
  /** Tenancy end date — 100% populated, unlike most of this record. */
  endDate: string | null;
  /** "fixed_term" | "periodic" | "fixed_periodic". */
  leaseType: string | null;
  /** "ast" | "company" | "apt" | … */
  agreementType: string | null;
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
    /** Propoly's standing order reference. Present means one has been set up
     *  there — evidence for the checklist item, not a substitute for it. */
    standingOrderRef?: string | null;
    /** The deal's extra clauses include a Flatfair "deposit replacement"
     *  clause — the tenant pays NO cash deposit, so the deposit figure above
     *  is a liability cap, not money to register with a scheme. ~44% of
     *  sampled deals (2 Aug 2026). */
    depositReplacement?: boolean;
    /** The landlord on the deal — populated on 99% of deals and thrown away
     *  until now. Kirstie has never had a landlord contact on the file. */
    landlord?: { name: string | null; email: string | null; phone: string | null } | null;
    /** Guarantors, where the deal has them (~31%). */
    guarantors?: Array<{ name: string | null; email: string | null; phone: string | null }>;
  };
  /** Portal overlay: pre-tenancy notes/stage-moves/checklist (lib/deal-store). */
  portal?: import("@/lib/types").DealPortalOverlay;
  /**
   * Rent that actually landed for this property, from PayProp — the only
   * milestone on the progression board with a source of truth behind it.
   *
   * Present only when the address-derived join found a match, and absent is
   * NOT the same as "no rent received": the join is loose by design, so a miss
   * means we could not tell, and the UI has to say so rather than show a zero.
   */
  rentReceived?: {
    amount: number;
    /** Reconciliation date — when PayProp matched the money, not when it was due. */
    on: string;
    /** False while the onward payment is still "not approved". */
    paidOut: boolean;
  };
}

function stageOfStatus(id: string): ApplicationStage {
  if (id === "accepted") return "accepted";
  if (id === "unsuccessful") return "unsuccessful";
  if (id === "communicated") return "communicated";
  return "received";
}

/**
 * Whole days between two dates, or null if either is missing or unreadable.
 *
 * Returns null rather than 0 for a negative span: REX lets these dates be
 * edited by hand, so "communicated before it was received" happens, and a
 * clamped 0 would quietly pull an average down. A gap we can't explain is
 * better left out of the maths than rounded into it.
 */
function daysBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const days = Math.round((b - a) / 86_400_000);
  return days < 0 ? null : days;
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

  const dateReceived = str(r.date_received);
  const dateCommunicated = str(r.date_communicated);
  const dateAccepted = str(r.date_accepted);
  const dateUnsuccessful = str(r.date_unsuccessful);
  // Either outcome ends the landlord's clock — an offer turned down took just
  // as long to decide as one accepted, and counting only the wins would make
  // the agency look faster than it is.
  const decidedOn = dateAccepted ?? dateUnsuccessful;

  return {
    id: String(r.id ?? ""),
    stage: stageOfStatus(statusId),
    status: label(r.application_status) ?? "Received",
    dateCommunicated,
    dateAccepted,
    dateUnsuccessful,
    daysToLandlord: daysBetween(dateReceived, dateCommunicated),
    daysToDecision: daysBetween(dateCommunicated, decidedOn),
    endDate: str(r.end_date),
    leaseType: label(r.lease_type),
    agreementType: label(r.agreement_type),
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
/**
 * Every current listing in the business, not one agent's.
 *
 * Kirstie's board is business-wide and she is not an agent, so the per-agent
 * index has nothing to match her deals against. Same search as
 * getAgentListings with the listing_agent_1_id criterion dropped — and
 * therefore paged, because the business runs to several hundred listings and
 * REX hard-caps a page at 100.
 *
 * Cached for longer than the per-agent one. It is a much bigger walk and the
 * thing it feeds — a photo on a deal — does not change minute to minute.
 */
const BUSINESS_LISTINGS_TTL_MS = 15 * 60 * 1000;
// 2,000 listings. The old cap was 12 pages against a comment claiming "~600
// live" — there were 1,613 current listings by 2 Aug 2026, so it truncated at
// 1,200 and silently dropped 413. A cap sized off a stale count fails quietly,
// which is the worst way for it to fail: the page just shows fewer photos. The
// walk still stops early on the first short page, so this ceiling only exists
// to stop a runaway, not to bound normal work (8 pages today).
const BUSINESS_LISTINGS_MAX_PAGES = 20;

// REX's lettings listing categories. `commercial_rental` is in here because
// the account carries a handful and a photo is a photo.
const LETTINGS_CATEGORIES = ["residential_rental", "rental", "commercial_rental"];
let businessListings: { at: number; data: AgentListing[] } | null = null;
let businessListingsInflight: Promise<AgentListing[] | null> | null = null;

/**
 * Timed 2 Aug 2026: eight pages, one after another, 10.6 SECONDS — and it sat
 * on the critical path of Kirstie's board, which otherwise takes about a
 * second. So this now does three things it didn't:
 *
 *   · fetches pages in parallel batches — 10,608ms sequential, 1,506ms in one
 *     batch of eight, measured on the live account
 *   · serves a STALE index while refreshing behind the request, so only the
 *     very first load after a deploy ever waits
 *   · lets the caller impose a deadline (see getBusinessPhotoIndex), because a
 *     board with no photos beats a board that isn't there yet
 */
// Eight: the index is 8 pages today, so one batch covers it. Measured on the
// live account — sequential 10,608ms, batches of 4 3,141ms, batches of 8
// 1,506ms, no rate-limit errors at either width. Concurrency stays bounded at
// 8 however far the book grows, so this cannot run away at REX.
const PAGE_BATCH = 8;

export async function getBusinessListings(): Promise<AgentListing[] | null> {
  if (!rexConfigured()) return null;
  const cached = businessListings;
  if (cached && Date.now() - cached.at < BUSINESS_LISTINGS_TTL_MS) return cached.data;

  // Stale but present: hand it straight back and let the refresh run behind
  // the request. A 15-minute-old photo is indistinguishable from a fresh one.
  if (cached) {
    if (!businessListingsInflight) void startBusinessListingsRefresh().catch(() => null);
    return cached.data;
  }
  return startBusinessListingsRefresh();
}

function startBusinessListingsRefresh(): Promise<AgentListing[] | null> {
  if (businessListingsInflight) return businessListingsInflight;

  const work = (async () => {
    const rows: Record<string, unknown>[] = [];
    const fetchPage = (page: number) =>
      rexCall("Listings", "search", {
        criteria: [
          // `leased` as well as `current`. This index exists to put a photo on
          // a LETTING, and REX moves a property out of `current` the moment it
          // is let — so the deals furthest through the pre-tenancy pipeline
          // were precisely the ones with no picture. Measured 2 Aug 2026: 422
          // leased listings, 99% of them with images, all previously excluded.
          { name: "system_listing_state", type: "in", value: ["current", "leased"] },
          // Lettings only. Of 1,613 `current` listings just 300 are rentals —
          // the rest are sales, which a lettings deal can never match. The walk
          // was spending its whole page budget on them and truncating before it
          // reached the rentals. Scoped this way the index is 722 listings /
          // 8 pages: fewer REX calls than before AND complete.
          { name: "listing_category_id", type: "in", value: LETTINGS_CATEGORIES },
        ],
        extra_options: { extra_fields: ["related.listing_images"] },
        limit: COUNT_LIMIT,
        offset: page * COUNT_LIMIT,
      }).catch(() => null);

    let done = false;
    let walked = 0;
    for (let start = 0; start < BUSINESS_LISTINGS_MAX_PAGES && !done; start += PAGE_BATCH) {
      const pages = [];
      for (let i = 0; i < PAGE_BATCH && start + i < BUSINESS_LISTINGS_MAX_PAGES; i++) {
        pages.push(start + i);
      }
      const results = await Promise.all(pages.map(fetchPage));
      // Consume IN ORDER and stop at the first short or failed page, so an
      // overshooting batch contributes nothing rather than leaving a hole.
      for (const res of results) {
        walked++;
        // A failed page part-way means an INCOMPLETE index, and an incomplete
        // photo index is harmless — a deal simply shows no photo, which is what
        // it did before any of this existed. So keep what we have rather than
        // throwing it away.
        if (!res || !res.ok) {
          done = true;
          break;
        }
        const batch = rexRows(res.result);
        rows.push(...batch);
        if (batch.length < COUNT_LIMIT) {
          done = true;
          break;
        }
      }
    }
    // Hitting the ceiling means the index is short and every deal past it
    // silently loses its photo — the exact failure that went unnoticed for
    // months. Say so rather than truncating in silence.
    if (!done && walked >= BUSINESS_LISTINGS_MAX_PAGES) {
      console.warn(
        `[rex] business listing walk hit its ${BUSINESS_LISTINGS_MAX_PAGES}-page ceiling at ${rows.length} listings — the photo index is INCOMPLETE. Raise BUSINESS_LISTINGS_MAX_PAGES.`
      );
    }
    if (rows.length === 0) return null;
    const data = rows.map(toListing);
    businessListings = { at: Date.now(), data };
    return data;
  })();

  businessListingsInflight = work;
  // Free the slot when the walk settles, whether or not anyone awaited it —
  // the stale-while-revalidate path fires this and walks away. The identity
  // check stops a slow walk from clearing a newer one that replaced it.
  void work
    .catch(() => null)
    .finally(() => {
      if (businessListingsInflight === work) businessListingsInflight = null;
    });
  return work;
}

/**
 * The same postcode-bucketed index, built from every letting in the business.
 *
 * `deadlineMs` caps how long a caller will wait. Photos are decoration: a
 * board that arrives now without them beats one that arrives in ten seconds
 * with them. Giving up does NOT cancel the walk — it carries on filling the
 * cache, so the next load has the pictures.
 */
export async function getBusinessPhotoIndex(deadlineMs?: number): Promise<PhotoIndex> {
  const work = getBusinessListings().catch(() => null);
  const listings = deadlineMs
    ? await Promise.race([
        work,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), deadlineMs)),
      ])
    : await work;
  const index: PhotoIndex = new Map();
  for (const l of listings ?? []) {
    const pc = postcodeOf(l.name, l.locality);
    if (!pc || !l.image) continue;
    const { numbers, words } = tokensOf(l.name);
    const bucket = index.get(pc) ?? [];
    bucket.push({ listingId: l.id, image: l.image, images: l.images, numbers, words });
    index.set(pc, bucket);
  }
  // Richest listing first. A postcode often holds the same property more than
  // once — 2 Norwich Street is four listings, 10 Kensington Drive is two (one
  // current, one leased) — and when the address tokens can't separate them the
  // matcher falls back to the first in the bucket. Better that it be the one
  // with the most photos than whichever REX happened to page in first.
  for (const bucket of index.values()) {
    bucket.sort((a, b) => b.images.length - a.images.length);
  }
  return index;
}

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

/**
 * Evidence-grade match: null unless the address really pins ONE property.
 * matchListingPhoto below deliberately falls back to "same postcode, best
 * guess" because a wrong photo is cosmetic — but the review caught that
 * fallback carrying a ToB signing status onto the wrong property, which is
 * not. This variant returns a match only when the postcode bucket holds a
 * single property, or the tokens score >= 3 (a house number plus a street
 * word, or three street words) — never the zero-evidence fallback.
 */
export function matchListingConfident(
  index: PhotoIndex,
  name: string,
  locality: string
): ListingPhotoMatch | null {
  const pc = postcodeOf(name, locality);
  if (!pc) return null;
  const bucket = index.get(pc);
  if (!bucket?.length) return null;
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
  return bestScore >= 3 ? best : null;
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

/* --------------------------- contacts on a listing ------------------------ */

export interface ListingContact {
  id: string;
  name: string;
  /** REX's relationship label — "Landlord", "Tenant", "Listing Owner"… */
  role: string | null;
  email: string | null;
  phone: string | null;
}

const contactsCache = new Map<string, { at: number; data: ListingContact[] }>();
const CONTACTS_TTL_MS = 5 * 60_000;

/**
 * The people attached to one listing — landlord, tenant, whoever REX has
 * related to it. Comes off `related.contact_reln_listing`, which only
 * `Listings/read` returns (search rows do not carry it), so this is ONE call
 * per listing and is only ever made for a drawer someone has opened.
 *
 * Best-effort: an empty array means "we could not read them", never "there
 * are none" — the caller must say so.
 */
export async function getListingContacts(listingId: string): Promise<ListingContact[]> {
  if (!rexConfigured() || !listingId) return [];
  const cached = contactsCache.get(listingId);
  if (cached && Date.now() - cached.at < CONTACTS_TTL_MS) return cached.data;

  const res = await rexCall("Listings", "read", { id: listingId }).catch(() => null);
  if (!res || !res.ok) return [];
  const related = ((res.result as Record<string, unknown>)?.related ?? {}) as Record<
    string,
    unknown
  >;
  const rows = Array.isArray(related.contact_reln_listing)
    ? (related.contact_reln_listing as Array<Record<string, unknown>>)
    : [];

  const str = (v: unknown) => {
    const t = String(v ?? "").trim();
    return t ? t : null;
  };
  const out: ListingContact[] = [];
  for (const r of rows) {
    const contact = (r.contact ?? {}) as Record<string, unknown>;
    const name =
      str(contact.name) ??
      [str(contact.first_name), str(contact.last_name)].filter(Boolean).join(" ");
    if (!name) continue;
    const phones = Array.isArray(contact.phone_numbers)
      ? (contact.phone_numbers as Array<Record<string, unknown>>)
      : [];
    const emails = Array.isArray(contact.email_addresses)
      ? (contact.email_addresses as Array<Record<string, unknown>>)
      : [];
    out.push({
      id: String(contact.id ?? ""),
      name,
      role:
        str((r.reln_type as Record<string, unknown> | undefined)?.text) ??
        str(r.reln_type) ??
        null,
      email:
        str(contact.email_address) ??
        str(emails[0]?.email_address) ??
        str(emails[0]?.value),
      phone:
        str(contact.phone_number) ??
        str(phones[0]?.phone_number) ??
        str(phones[0]?.value),
    });
  }
  contactsCache.set(listingId, { at: Date.now(), data: out });
  return out;
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

/**
 * WHAT COMPLIANCE CAN AND CANNOT ANSWER — measured 11 Aug 2026, on the live
 * account, before any of this was written. Read this before "making it live
 * for the selected month", because the obvious version of that is wrong.
 *
 * 1. A COMPLIANCE ENTRY IS EDITED IN PLACE WHEN A CERTIFICATE IS RENEWED.
 *    Of 6,467 (parent, type) pairs in the account, 6,426 hold exactly ONE
 *    entry; only 41 hold more. So REX does not keep the superseded row. A
 *    property whose gas certificate expired in February and was renewed in
 *    March carries ONE entry, dated 2027 — and rewinding "overdue" by
 *    comparing today's expiry date against a past date would report that
 *    property as compliant in February, which is precisely backwards. Past
 *    overdue would come out systematically too LOW, on a compliance figure.
 *
 * 2. THE RECORD ONLY STARTS IN NOVEMBER 2025. Entries by creation month:
 *    Mar 2025: 87, then nothing until Nov 2025: 2,554 (the EPC bulk import),
 *    Dec: 353, and ~400–570 a month since. "As at September 2025" would
 *    therefore show a nearly empty book with almost nothing overdue — an
 *    artefact of when data entry began, rendered as a trading fact.
 *
 * So the STOCK (how many certificates are valid / expiring / overdue) is only
 * ever answerable as at TODAY, and the tab says so. What IS honestly
 * month-scoped are two FLOWS, both of which come straight off dates REX holds
 * and neither of which needs a history REX doesn't keep:
 *
 *   • RECORDED in the month  — system_ctime falls in it. Compliance admin
 *     actually done that month.
 *   • EXPIRING in the month  — expiry_date falls in it. Work that lands in
 *     that month, and the only one of the three that can be read FORWARD.
 *
 * Those two follow the month picker. The stock does not, and is stamped.
 */

/** One compliance entry, flattened to what any figure on the tab needs. */
export interface ComplianceCensusRow {
  /** REX parent_object_id — a property, a listing, or a contact. */
  parent: string;
  /** Raw REX type_id, e.g. "gas_safety". */
  type: string;
  /** Expiry, epoch ms. Null when REX holds no date (3,072 of 6,500 entries). */
  expiry: number | null;
  /** When the entry was created in REX, epoch ms. Populated on every row. */
  created: number;
  /** Is the certificate itself attached, or only a record that one exists? */
  hasFile: boolean;
}

export interface ComplianceCensus {
  at: number;
  rows: ComplianceCensusRow[];
}

const censusMem = { at: 0, data: null as ComplianceCensus | null };
let censusInflight: Promise<ComplianceCensus | null> | null = null;
/** The sweep is ~65 pages at ~13s each; six hours is generous and it is still
 *  refreshed behind the request as soon as it is stale. */
const CENSUS_TTL_MS = 6 * 60 * 60_000;
const CENSUS_KEY = "rex:compliance:census:v1";

/**
 * Every active compliance entry in REX, in one paged sweep.
 *
 * Two things make this work where the old aggregate didn't:
 *
 * • PAGES RUN IN PARALLEL. Measured: one page 12.4s, six pages together 14.7s —
 *   REX's latency here is per-request overhead, not throughput, so batching
 *   takes the whole account from ~14 minutes to ~2.
 * • THE 8s CALL TIMEOUT IS LIFTED for this sweep. Every ComplianceEntries page
 *   takes 12–13s, so the old walk was aborting on its FIRST page, returning
 *   null every time, and the Compliance tab had silently been showing the July
 *   snapshot rather than anything live. That is the bug behind "make it live".
 *
 * Returns the RAW entries rather than a summary, so the same sweep can answer
 * the as-at-today stock and both month flows without going back to REX.
 */
async function sweepCompliance(): Promise<ComplianceCensus | null> {
  const PAGE_BATCH = 8;
  const MAX_PAGES = 400;
  const PAGE_TIMEOUT_MS = 45_000;

  const fetchPage = (page: number) =>
    rexCall(
      "ComplianceEntries",
      "search",
      {
        criteria: [{ name: "system_record_state", type: "=", value: "active" }],
        limit: COUNT_LIMIT,
        offset: page * COUNT_LIMIT,
      },
      { timeoutMs: PAGE_TIMEOUT_MS }
    ).catch(() => null);

  const rows: Array<Record<string, unknown>> = [];
  let done = false;
  let walked = 0;
  for (let start = 0; start < MAX_PAGES && !done; start += PAGE_BATCH) {
    const pages: number[] = [];
    for (let i = 0; i < PAGE_BATCH && start + i < MAX_PAGES; i++) pages.push(start + i);
    const results = await Promise.all(pages.map(fetchPage));
    // Consumed IN ORDER, stopping at the first failed or short page, so an
    // overshooting batch contributes nothing rather than leaving a hole.
    for (const res of results) {
      walked++;
      if (!res || !res.ok) return null; // a hole in the middle is not a total
      const batch = rexRows(res.result);
      rows.push(...batch);
      if (batch.length < COUNT_LIMIT) {
        done = true;
        break;
      }
    }
  }
  // Still full at the ceiling: the account is bigger than the walk. Reporting
  // that as a total is how "6,000 entries" got mistaken for the whole book
  // once already.
  if (!done && walked >= MAX_PAGES) return null;
  if (rows.length === 0) return null;

  const data: ComplianceCensus = {
    at: Date.now(),
    rows: rows.map((r) => {
      const type = String(label(r.type_id) ?? "unknown");
      const details = (r.details ?? {}) as Record<string, unknown>;
      // Type key first, sole block as the fallback — taking whichever block
      // sorted first dates an entry from the wrong certificate.
      const block = complianceDetailBlock(details, type) as { expiry_date?: string | null };
      const expiry = block.expiry_date ? Date.parse(String(block.expiry_date)) : NaN;
      const created = Number(r.system_ctime);
      return {
        parent: String(r.parent_object_id ?? ""),
        type,
        expiry: Number.isFinite(expiry) ? expiry : null,
        created: Number.isFinite(created) ? created * 1000 : 0,
        hasFile: !!complianceFileUrl(r),
      };
    }),
  };
  return data;
}

export async function getComplianceCensus(): Promise<ComplianceCensus | null> {
  if (censusMem.data && Date.now() - censusMem.at < CENSUS_TTL_MS) return censusMem.data;
  if (!rexConfigured()) return null;

  const { readCache, writeCache } = await import("@/lib/integration-cache");
  if (!censusMem.data) {
    const stored = await readCache<ComplianceCensus>(CENSUS_KEY).catch(() => null);
    if (stored?.data?.rows?.length) {
      censusMem.at = stored.at;
      censusMem.data = stored.data;
    }
  }
  const fresh = censusMem.data && Date.now() - censusMem.at < CENSUS_TTL_MS;
  if (fresh) return censusMem.data;

  // Stale but present: serve it and refresh behind the request. A six-hour-old
  // expiry date is not meaningfully different from a fresh one, and two minutes
  // of waiting is.
  if (!censusInflight) {
    censusInflight = sweepCompliance()
      .then(async (data) => {
        if (data) {
          censusMem.at = data.at;
          censusMem.data = data;
          await writeCache(CENSUS_KEY, data).catch(() => undefined);
        }
        return data;
      })
      .catch(() => null)
      .finally(() => {
        censusInflight = null;
      });
  }
  if (censusMem.data) return censusMem.data;
  return censusInflight;
}

/* ------------------------------ summarising ------------------------------ */

export interface ComplianceBucketRow {
  key: string;
  label: string;
  total: number;
  overdue: number;
  upcoming: number;
}

export interface ComplianceAgentRowLive extends ComplianceBucketRow {
  pctOverdue: number;
  /** Certificates recorded by / against this partner in the selected month. */
  recorded: number;
  /** Certificates of theirs that expire in the selected month. */
  expiring: number;
}

export interface ComplianceSummary {
  /** When the STOCK below was read. Always now — see the note at the top. */
  asAt: string;
  /** The month the FLOWS below cover — this one does follow the picker. */
  month: string;
  /* ---- stock, as at today ---- */
  totalItems: number;
  overdue: number;
  upcoming: number;
  valid: number;
  /** Entries REX holds no expiry date for — counted, never flagged either way. */
  noExpiry: number;
  byType: ComplianceBucketRow[];
  byAgent: ComplianceAgentRowLive[];
  /* ---- flows, for `month` ---- */
  recordedInMonth: number;
  expiringInMonth: number;
  overdueAtMonthEnd: null;
  /** Recorded per month for the twelve months ending at `month` — the trend. */
  recordedSeries: Array<{ month: string; recorded: number; expiring: number }>;
  /* ---- what the figures above do NOT cover ---- */
  /**
   * Certificates on lettings properties belonging to ANOTHER business in this
   * shared REX account. Excluded from every figure above — see the scoping
   * note in getComplianceAsAt.
   */
  otherBusinesses: number;
  /** Property certificates on a property no current lettings listing claims. */
  unattributed: number;
  /** Contact-level checks (ID, AML, right to rent) — a different job entirely. */
  contactEntries: number;
  /** Expiry dates REX holds that are not real years — 3033, 8203. Typos. */
  impossibleDates: number;
  /** Was the partner map available? False = byAgent is empty, not zero. */
  agentsResolved: boolean;
  /**
   * Did the TLE partner list resolve, so the figures are TLE's own book? False
   * means REX wouldn't name the partners and the figures cover every lettings
   * property in the shared account — a much bigger number, and the tab has to
   * say so rather than let it read as TLE's.
   */
  tleScoped: boolean;
}

const UPCOMING_DAYS = 60;
const MONTH_RE_STATS = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthBounds(month: string): { start: number; end: number } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return {
    start: Date.UTC(y, m - 1, 1),
    end: Date.UTC(y, m, 1), // exclusive
  };
}

/**
 * The Compliance tab's figures, live from the census.
 *
 * `month` scopes the FLOWS only. The stock is as at now, by necessity — see
 * the note at the top of this section for the two measurements that rule out
 * rebuilding it.
 */
export async function getComplianceAsAt(month: string): Promise<ComplianceSummary | null> {
  const census = await getComplianceCensus();
  if (!census) return null;
  const sel = MONTH_RE_STATS.test(month) ? month : new Date().toISOString().slice(0, 7);

  /*
   * SCOPING — why this is not simply "every compliance entry in REX".
   *
   * Six businesses share this REX account. Swept raw on 11 Aug 2026 it holds
   * 4,496 property certificates, of which only ~1,550 sit on a property a TLE
   * partner has listed: 3,004 of them are EPCs, mostly against The Property
   * Experts' sales stock. A headline of "4,496 certificates, 448 overdue" on
   * Susan's dashboard is therefore not a big number about TLE — it is mostly
   * somebody else's book, and 213 of those overdue certificates are nobody
   * here's to chase.
   *
   * So the figures are scoped to properties whose listing agent is a TLE
   * partner, and the two excluded groups are counted and shown rather than
   * quietly dropped.
   *
   * Compliance hangs off a property (sometimes off the listing), so both ids
   * are mapped.
   */
  const [listings, tleAgents] = await Promise.all([
    getBusinessListings().catch(() => null),
    rexLettingsAgents().catch(() => [] as Array<{ id: string; email: string }>),
  ]);
  const tleIds = new Set(tleAgents.map((a) => a.id));
  // An empty partner list is a FAILURE, not "no TLE partners". Falling through
  // with it would classify the entire book as another business's and render
  // zeros — so scoping is dropped instead, and the flag says the figures are
  // account-wide.
  const tleScoped = tleIds.size > 0;
  const agentOf = new Map<string, { name: string; tle: boolean }>();
  for (const l of listings ?? []) {
    const name = l.agentName;
    if (!name) continue;
    const entry = { name, tle: !tleScoped || (!!l.agentId && tleIds.has(l.agentId)) };
    if (l.propertyId) agentOf.set(l.propertyId, entry);
    if (l.id) agentOf.set(l.id, entry);
  }

  const now = Date.now();
  const { start, end } = monthBounds(sel);
  // Anything past this is a typo, not a date. Measured: three entries expire in
  // 3033 and one in 8203.
  const ABSURD = Date.UTC(2100, 0, 1);

  const byType = new Map<string, ComplianceBucketRow>();
  const byAgent = new Map<string, ComplianceAgentRowLive>();
  let totalItems = 0;
  let overdue = 0;
  let upcoming = 0;
  let valid = 0;
  let noExpiry = 0;
  let contactEntries = 0;
  let otherBusinesses = 0;
  let unattributed = 0;
  let impossibleDates = 0;
  let recordedInMonth = 0;
  let expiringInMonth = 0;

  const series = new Map<string, { month: string; recorded: number; expiring: number }>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(Number(sel.slice(0, 4)), Number(sel.slice(5, 7)) - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
    series.set(key, { month: key, recorded: 0, expiring: 0 });
  }

  for (const r of census.rows) {
    // Contact-level checks (ID, proof of address, AML, NRL, right to rent,
    // referencing) live in the same table and are a different job. Counted so
    // the difference from REX's own 6,400-entry total is explainable, then set
    // aside — the old tile added them to "compliance items", which is why it
    // read 6,397 against a book of ~1,100 properties.
    if (!PROPERTY_COMPLIANCE[r.type]) {
      contactEntries++;
      continue;
    }

    const owner = agentOf.get(r.parent) ?? null;
    // Counted, then set aside. Both of these are real certificates — they are
    // simply not TLE's to chase, and mixing them in is what made the old
    // headline four times the size of the book it claimed to describe.
    if (!owner) {
      unattributed++;
      continue;
    }
    if (!owner.tle) {
      otherBusinesses++;
      continue;
    }
    const agent = owner.name;
    totalItems++;

    const bucket =
      byType.get(r.type) ??
      { key: r.type, label: PROPERTY_COMPLIANCE[r.type], total: 0, overdue: 0, upcoming: 0 };
    bucket.total++;

    const agentRow: ComplianceAgentRowLive = byAgent.get(agent) ?? {
      key: agent,
      label: agent,
      total: 0,
      overdue: 0,
      upcoming: 0,
      pctOverdue: 0,
      recorded: 0,
      expiring: 0,
    };
    agentRow.total++;

    if (r.expiry != null && r.expiry < ABSURD) {
      const days = (r.expiry - now) / 86_400_000;
      if (days < 0) {
        overdue++;
        bucket.overdue++;
        agentRow.overdue++;
      } else if (days <= UPCOMING_DAYS) {
        upcoming++;
        bucket.upcoming++;
        agentRow.upcoming++;
      } else {
        valid++;
      }
      if (r.expiry >= start && r.expiry < end) {
        expiringInMonth++;
        agentRow.expiring++;
      }
      const em = new Date(r.expiry).toISOString().slice(0, 7);
      const eBucket = series.get(em);
      if (eBucket) eBucket.expiring++;
    } else {
      if (r.expiry != null) impossibleDates++;
      // No usable expiry — counted, flagged neither way. Same rule as the
      // per-property view, where it renders as "no date recorded".
      noExpiry++;
    }

    if (r.created >= start && r.created < end) {
      recordedInMonth++;
      agentRow.recorded++;
    }
    const cm = r.created ? new Date(r.created).toISOString().slice(0, 7) : null;
    const cBucket = cm ? series.get(cm) : null;
    if (cBucket) cBucket.recorded++;

    byType.set(r.type, bucket);
    byAgent.set(agent, agentRow);
  }

  return {
    asAt: new Date(census.at).toISOString(),
    month: sel,
    totalItems,
    overdue,
    upcoming,
    valid,
    noExpiry,
    byType: [...byType.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total),
    byAgent: [...byAgent.values()]
      .map((a) => ({ ...a, pctOverdue: a.total ? (a.overdue / a.total) * 100 : 0 }))
      .sort((a, b) => b.overdue - a.overdue || b.total - a.total),
    recordedInMonth,
    expiringInMonth,
    // Deliberately null and deliberately present: the tab asks for it, and the
    // answer is "this cannot be known", not zero.
    overdueAtMonthEnd: null,
    recordedSeries: [...series.values()],
    otherBusinesses,
    unattributed,
    contactEntries,
    impossibleDates,
    agentsResolved: !!listings && listings.length > 0,
    tleScoped,
  };
}
