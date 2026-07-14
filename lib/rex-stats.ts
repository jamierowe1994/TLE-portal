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

type Criterion = { name: string; type: string; value: string };

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

  const work = (async (): Promise<AgentListing[] | null> => {
    const caps = await getCapabilities();
    if (!caps.capabilities.login || !caps.capabilities.listings) return null;

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

    return rexRows(res.result)
      .map(toListing)
      .sort((a, b) => a.address.localeCompare(b.address, "en-GB"));
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
