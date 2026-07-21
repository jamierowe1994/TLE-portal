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

    // Market appraisals — appraisals dated within the month.
    if (caps.capabilities.appraisals) {
      const maCount = await countSearch("Appraisals", [
        { name: "agent_1_id", type: "=", value: rexUserId },
        { name: "appraisal_date", type: ">=", value: range.start },
        { name: "appraisal_date", type: "<=", value: range.end },
      ]);
      if (maCount != null) {
        out.marketAppraisals = {
          value: maCount,
          source: "live-rex",
          note: `Live count from REX Appraisals (agent_1_id, appraisal_date in ${month}).`,
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
    const [applications, listingRows, viewingRows] = await Promise.all([
      countSearch("TenancyApplications", [
        { name: "application.agent_id", type: "in", value: agentIds },
        { name: "application.date_accepted", type: ">=", value: range.start },
        { name: "application.date_accepted", type: "<=", value: range.end },
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

    const newListings = listingRows
      ? listingRows.filter((r) => {
          const cat = r.listing_category as { id?: string; text?: string } | string | null;
          const catText = typeof cat === "object" && cat ? (cat.text ?? cat.id) : cat;
          const pub = r.system_publication_status as { id?: string } | string | null;
          const pubId = typeof pub === "object" && pub ? pub.id : pub;
          return String(catText ?? "").toLowerCase().includes("rental") && pubId !== "draft";
        }).length
      : null;

    const viewings = viewingRows
      ? viewingRows.filter((r) => !(r.is_cancelled === true || r.is_cancelled === 1)).length
      : null;

    if (applications == null && newListings == null && viewings == null) return null;
    const data = { applications, newListings, viewings };
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

// The agent's managed portfolio (count + monthly rent roll) from their leased
// listings. Live, current-state. null on any failure → caller keeps snapshot.
export async function getAgentPortfolio(rexUserId: string): Promise<AgentPortfolio | null> {
  if (!rexConfigured() || !rexUserId) return null;

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
    return { managed: rows.length, rentRoll };
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
 * The listing's hero shot. REX orders images by `priority` (1 = first), and
 * ships pre-made thumbs — take the 400x300 for a tile rather than pulling a
 * 1200x800 original per card.
 */
function heroImage(r: Record<string, unknown>): { url: string | null; count: number } {
  const related = (r.related ?? {}) as Record<string, unknown>;
  const images = Array.isArray(related.listing_images)
    ? (related.listing_images as Array<Record<string, unknown>>)
    : [];
  if (images.length === 0) return { url: null, count: 0 };

  const hero = [...images].sort(
    (a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999)
  )[0];
  const thumbs = (hero.thumbs ?? {}) as Record<string, { url?: string }>;
  const url =
    absoluteUrl(thumbs["400x300"]?.url) ??
    absoluteUrl(thumbs["800x600"]?.url) ??
    absoluteUrl(hero.url);
  return { url, count: images.length };
}

function toListing(r: Record<string, unknown>): AgentListing {
  const property = (r.property ?? {}) as Record<string, unknown>;
  const hero = heroImage(r);
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

/**
 * The agent's properties with their compliance, worst first. Live from REX.
 * null on failure so the caller can say so rather than imply all-clear.
 */
export async function getAgentCompliance(
  rexUserId: string
): Promise<PropertyCompliance[] | null> {
  if (!rexConfigured() || !rexUserId) return null;

  const work = (async (): Promise<PropertyCompliance[] | null> => {
    const listings = await getAgentListings(rexUserId);
    if (!listings) return null;

    // Compliance hangs off the property (and sometimes the listing), so ask for
    // both ids in one go rather than a call per property.
    const propertyIds = listings.map((l) => l.propertyId).filter(Boolean);
    const ids = [...new Set([...propertyIds, ...listings.map((l) => l.id)])];
    if (ids.length === 0) return [];

    const res = await rexCall("ComplianceEntries", "search", {
      criteria: [{ name: "parent_object_id", type: "in", value: ids }],
      limit: COUNT_LIMIT,
    }).catch(() => null);
    if (!res || !res.ok) return null;

    // Bucket entries by the id they hang off.
    const byParent = new Map<string, ComplianceItem[]>();
    for (const row of rexRows(res.result)) {
      const item = toComplianceItem(row);
      if (!item) continue;
      const parent = String(row.parent_object_id ?? "");
      if (!parent) continue;
      const list = byParent.get(parent) ?? [];
      list.push(item);
      byParent.set(parent, list);
    }

    const out = listings.map((l) => {
      const items = [
        ...(byParent.get(l.propertyId) ?? []),
        ...(byParent.get(l.id) ?? []),
      ].sort((a, b) => a.label.localeCompare(b.label));
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
    return out.sort(
      (a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name, "en-GB")
    );
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
