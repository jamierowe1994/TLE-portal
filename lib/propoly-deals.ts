import "server-only";
import { propolyConfigured, propolyGet } from "@/lib/propoly";
import { loadSnapshot, saveSnapshot } from "@/lib/propoly-snapshot";
import { agentKeysForName } from "@/lib/roster";
import type {
  AgentApplication,
  ApplicationStage,
  ApplicationTenant,
} from "@/lib/rex-stats";

// Propoly deals → the agent's tenancy-progression pipeline, normalised into
// the same AgentApplication shape the Applications tab already renders (so
// the UI needed no changes when the source flipped from REX to Propoly).
//
// Shapes confirmed against the live API, 21 Jul 2026:
//   GET /deals?tenancy_status=X&per_page=25&page=N
//     → { deals: [...], total_entries, per_page (caps at 25) }
//   statuses: start_deal · holding_fee · references · tenancy_generation ·
//             signing_and_move_in_monies · complete · cancelled
//   GET /properties → rows carry managed_by_user_data { email, first/last }
//     — the per-agent key: matches the agent's portal login email.
//
// CONTRACT (as lib/rex-stats.ts): never throw into a page — return null so
// the caller can fall back; cache so a dashboard load doesn't hammer them.

const PER_PAGE = 25;
const DEALS_TTL_MS = 60_000; // active pipeline — changes during the day
const PROPS_TTL_MS = 10 * 60_000; // property→manager map — changes rarely
const OVERALL_DEADLINE_MS = 15_000; // cold cache is ~30 parallel calls

// Progression order (order asc = earliest stage). complete is excluded —
// those are move-ins, not pipeline; cancelled feeds the page's hidden
// "unsuccessful" section.
const STATUS_INFO: Record<string, { label: string; stage: ApplicationStage; order: number }> = {
  start_deal: { label: "Deal started", stage: "received", order: 0 },
  holding_fee: { label: "Holding fee taken", stage: "received", order: 1 },
  references: { label: "Awaiting references", stage: "communicated", order: 2 },
  tenancy_generation: { label: "Tenancy generation", stage: "communicated", order: 3 },
  signing_and_move_in_monies: { label: "Signing & move-in monies", stage: "accepted", order: 4 },
  cancelled: { label: "Cancelled", stage: "unsuccessful", order: 99 },
};
const ACTIVE_STATUSES = [
  "start_deal",
  "holding_fee",
  "references",
  "tenancy_generation",
  "signing_and_move_in_monies",
] as const;

const SERVICE_LABELS: Record<string, string> = {
  full_managed: "Fully managed",
  tenant_find: "Tenant find",
  rent_collect: "Rent collect",
};

/* ------------------------------------------------------------------------ */
/* Paged fetching                                                            */
/* ------------------------------------------------------------------------ */

function rowsOf(body: unknown): Array<Record<string, unknown>> | null {
  if (!body || typeof body !== "object") return null;
  const arr = Object.values(body as Record<string, unknown>).find(Array.isArray);
  return arr ? (arr as Array<Record<string, unknown>>) : null;
}

/**
 * Fetch every page of a list endpoint (page 1 first, the rest in parallel).
 * NEVER throws — a token failure (e.g. Propoly's 429 backoff) must surface
 * as null so callers fall back to their last-good snapshot, not as an
 * exception that skips the fallback entirely.
 */
async function listAll(
  basePath: string,
  maxPages: number
): Promise<Array<Record<string, unknown>> | null> {
  try {
    return await listAllInner(basePath, maxPages);
  } catch {
    return null;
  }
}

async function listAllInner(
  basePath: string,
  maxPages: number
): Promise<Array<Record<string, unknown>> | null> {
  const sep = basePath.includes("?") ? "&" : "?";
  const first = await propolyGet(`${basePath}${sep}per_page=${PER_PAGE}&page=1`);
  if (first.status !== 200) return null;
  const env = first.body as Record<string, unknown>;
  let rows = rowsOf(env);
  if (!rows) return null;
  rows = [...rows];

  const total = typeof env.total_entries === "number" ? env.total_entries : rows.length;
  const perPage =
    typeof env.per_page === "number" && env.per_page > 0 ? env.per_page : PER_PAGE;
  const pages = Math.min(Math.ceil(total / perPage), maxPages);
  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) =>
        propolyGet(`${basePath}${sep}per_page=${PER_PAGE}&page=${i + 2}`)
      )
    );
    for (const res of rest) {
      const more = res.status === 200 ? rowsOf(res.body) : null;
      if (more) rows.push(...more);
    }
  }
  // A silently-dropped page must fail the whole fetch — callers CACHE these
  // lists, and a partial one reads as "fewer move-ins/deals than reality"
  // for the next 10 minutes (we watched YTD show 112 instead of 146).
  const expected = Math.min(total, pages * perPage);
  if (rows.length < expected) return null;
  return rows;
}

/* ------------------------------------------------------------------------ */
/* Property → manager map                                                    */
/* ------------------------------------------------------------------------ */

interface Manager {
  email: string | null;
  name: string;
}

let propCache: { at: number; map: Map<string, Manager> } | null = null;

async function propertyManagers(): Promise<Map<string, Manager> | null> {
  if (propCache && Date.now() - propCache.at < PROPS_TTL_MS) return propCache.map;
  // Cold start (fresh deploy): seed from the persisted last-good pull so we
  // only ask Propoly for the refresh, not the whole 23-page book.
  if (!propCache) {
    const snap = await loadSnapshot<[string, Manager][]>("managers");
    if (snap) {
      propCache = { at: snap.savedAt, map: new Map(snap.data) };
      if (Date.now() - snap.savedAt < PROPS_TTL_MS) return propCache.map;
    }
  }
  const rows = await listAll("/api/v1/properties", 40); // 574 props ≈ 23 pages
  if (!rows) return propCache?.map ?? null; // stale beats nothing
  const map = new Map<string, Manager>();
  for (const p of rows) {
    const uuid = typeof p.uuid === "string" ? p.uuid : null;
    const mgr = p.managed_by_user_data as Record<string, unknown> | null | undefined;
    if (!uuid || !mgr || typeof mgr !== "object") continue;
    const email = typeof mgr.email === "string" ? mgr.email.trim().toLowerCase() : null;
    const name = [mgr.first_name, mgr.last_name]
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .join(" ")
      .trim();
    map.set(uuid, { email, name });
  }
  propCache = { at: Date.now(), map };
  void saveSnapshot("managers", [...map.entries()]);
  return map;
}

/* ------------------------------------------------------------------------ */
/* Deals                                                                     */
/* ------------------------------------------------------------------------ */

interface CachedDeal {
  app: AgentApplication;
  statusKey: string;
  managerEmail: string | null;
  managerName: string | null;
}

let dealsCache: { at: number; deals: CachedDeal[] } | null = null;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** "4 Staddon Gardens,\nTorquay,\nDevon,\nTQ2 8DP" → name + locality. */
function splitAddress(raw: unknown): { name: string; locality: string } {
  const lines = (typeof raw === "string" ? raw : "")
    .split(/\n+/)
    .map((l) => l.replace(/,\s*$/, "").trim())
    .filter(Boolean);
  if (lines.length === 0) return { name: "Address unavailable", locality: "" };
  // "Flat 1" alone isn't a name — take the building line with it.
  const nameLines = /^(flat|apartment|unit|room|studio)\b/i.test(lines[0]) && lines.length > 2 ? 2 : 1;
  const name = lines.slice(0, nameLines).join(", ");
  const town = lines[nameLines] ?? "";
  const last = lines[lines.length - 1] ?? "";
  const postcode = last !== town && /\d/.test(last) ? last : "";
  return { name, locality: [town, postcode].filter(Boolean).join(" ") };
}

function toApplication(d: Record<string, unknown>, statusKey: string): AgentApplication {
  const info = STATUS_INFO[statusKey] ?? {
    label: statusKey.replace(/_/g, " "),
    stage: "received" as ApplicationStage,
    order: 50,
  };
  const { name, locality } = splitAddress(d.property_address);

  const rawTenants = Array.isArray(d.tenant_details)
    ? (d.tenant_details as Array<Record<string, unknown>>)
    : [];
  const tenants: ApplicationTenant[] = rawTenants.map((t, i) => ({
    name: str(t.name) ?? "Unnamed tenant",
    email: str(t.email),
    phone: str(t.phone),
    isPrimary: i === 0,
  }));

  const pencePcm = typeof d.price_pcm_pence === "number" ? d.price_pcm_pence : null;
  const depositPence = typeof d.deposit_pence === "number" ? d.deposit_pence : null;
  const holdingPence = typeof d.holding_fee_pence === "number" ? d.holding_fee_pence : null;
  const service = SERVICE_LABELS[String(d.tenancy_service_level ?? "")] ?? null;
  const pets = d.pets;
  const hasPets =
    pets === true || (typeof pets === "string" && /^(y|yes|true)/i.test(pets.trim()));

  return {
    id: String(d.uuid ?? ""),
    stage: info.stage,
    status: info.label,
    propertyName: name,
    locality,
    image: null, // Propoly has no listing photos
    offer: pencePcm != null ? Math.round(pencePcm / 100) : null,
    offerPeriod: "month",
    affordability: null,
    dateReceived: str(d.created_at)?.slice(0, 10) ?? null,
    startDate: str(d.move_in_date),
    agreementMonths: null,
    occupants: tenants.length || null,
    hasPets,
    tenants,
    notes: null,
    conditions: null,
    // The progression board on the Applications drawer runs off this.
    propoly: {
      statusKey,
      holdingFee: holdingPence != null ? Math.round(holdingPence / 100) : null,
      deposit: depositPence != null ? Math.round(depositPence / 100) : null,
      service,
    },
  };
}

async function fetchAllDeals(): Promise<CachedDeal[] | null> {
  if (dealsCache && Date.now() - dealsCache.at < DEALS_TTL_MS) return dealsCache.deals;
  if (!dealsCache) {
    const snap = await loadSnapshot<CachedDeal[]>("deals");
    if (snap) {
      dealsCache = { at: snap.savedAt, deals: snap.data };
      if (Date.now() - snap.savedAt < DEALS_TTL_MS) return dealsCache.deals;
    }
  }

  const [managerMap, ...statusLists] = await Promise.all([
    propertyManagers(),
    ...ACTIVE_STATUSES.map((s) => listAll(`/api/v1/deals?tenancy_status=${s}`, 8)),
    // Cancelled outnumber live 191:120 — one page feeds the hidden section.
    listAll("/api/v1/deals?tenancy_status=cancelled", 1),
  ]);
  const keys = [...ACTIVE_STATUSES, "cancelled"];
  // Any missing status list would under-count that stage for the cache TTL —
  // serve the previous complete snapshot instead (stale beats silently wrong).
  if (statusLists.some((l) => l == null)) return dealsCache?.deals ?? null;

  const deals: CachedDeal[] = [];
  statusLists.forEach((rows, i) => {
    for (const d of rows ?? []) {
      const propertyUuid = typeof d.property_uuid === "string" ? d.property_uuid : null;
      const mgr = propertyUuid ? managerMap?.get(propertyUuid) : undefined;
      deals.push({
        app: toApplication(d, keys[i]),
        statusKey: keys[i],
        managerEmail: mgr?.email ?? null,
        managerName: mgr?.name ?? null,
      });
    }
  });

  dealsCache = { at: Date.now(), deals };
  void saveSnapshot("deals", deals);
  return deals;
}

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

export interface PropolyUserRef {
  email: string;
  agentKey: string | null;
}

/** One deal as the pre-tenancy dashboard sees it: app shape + who runs it. */
export interface BusinessDeal {
  app: AgentApplication;
  statusKey: string;
  managerEmail: string | null;
  managerName: string | null;
}

/**
 * Every deal in the book (active + one page of cancelled), all agents —
 * powers Kirstie's /pretenancy dashboard. null = unconfigured/unreachable.
 */
export async function getAllPropolyDeals(): Promise<BusinessDeal[] | null> {
  if (!propolyConfigured()) return null;
  const work = fetchAllDeals();
  const deadline = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), OVERALL_DEADLINE_MS)
  );
  try {
    return await Promise.race([work, deadline]);
  } catch {
    return null;
  }
}

/** Find one deal by Propoly uuid (from the same cache as the lists). */
export async function findPropolyDeal(id: string): Promise<BusinessDeal | null> {
  const deals = await getAllPropolyDeals();
  return deals?.find((d) => d.app.id === id) ?? null;
}

/** Note/read authorization: does this deal belong to this portal user? */
export function dealBelongsToUser(deal: BusinessDeal, user: PropolyUserRef): boolean {
  return belongsTo(deal, user);
}

function belongsTo(deal: CachedDeal, user: PropolyUserRef): boolean {
  if (deal.managerEmail && deal.managerEmail === user.email.trim().toLowerCase()) {
    return true;
  }
  // Fallback: the property manager's name resolves to this partner's roster
  // slug (covers portal accounts registered under a different email).
  if (user.agentKey && deal.managerName) {
    return agentKeysForName(deal.managerName).includes(user.agentKey);
  }
  return false;
}

/**
 * The signed-in agent's live tenancy progression from Propoly, as
 * AgentApplication rows: nearest-to-completion first, cancelled last.
 * null = not configured / couldn't reach Propoly (caller falls back).
 */
export async function getPropolyAgentDeals(
  user: PropolyUserRef
): Promise<AgentApplication[] | null> {
  if (!propolyConfigured()) return null;

  const work = (async () => {
    const deals = await fetchAllDeals();
    if (!deals) return null;
    return deals
      .filter((d) => belongsTo(d, user))
      .sort((a, b) => {
        // Closest-to-keys first (signing → … → deal started), cancelled
        // sinks to the end, ties broken by soonest move-in.
        const oa = STATUS_INFO[a.statusKey]?.order ?? 50;
        const ob = STATUS_INFO[b.statusKey]?.order ?? 50;
        const ka = oa === 99 ? -1 : oa;
        const kb = ob === 99 ? -1 : ob;
        if (ka !== kb) return kb - ka;
        return (a.app.startDate ?? "9999").localeCompare(b.app.startDate ?? "9999");
      })
      .map((d) => d.app);
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

// (A getPropolyPipelineCount helper lived here. Callers now take the deals
// themselves and count `stage !== "unsuccessful"` off the array they render,
// so the pipeline figure and the list behind it can't disagree.)

/* ------------------------------------------------------------------------ */
/* Business-wide stats (admin dashboard)                                     */
/* ------------------------------------------------------------------------ */

export interface PropolyBusinessStats {
  month: string;
  pipelineTotal: number; // every deal in progression, whole business
  pipelineByStage: { key: string; label: string; count: number }[];
  moveInsThisMonth: number; // completed deals whose move-in falls in `month`
  generatedAt: string;
}

// Completed deals are the big list (500+) — cached separately and longer.
// propertyUuid lets us resolve the managing agent (via propertyManagers)
// for per-agent move-in reporting (ramp time).
interface CompletedDeal {
  date: string | null; // move_in_date
  service: string | null; // full_managed | tenant_find | rent_collect
  propertyUuid: string | null;
}

let completesCache: { at: number; completes: CompletedDeal[] } | null = null;
const COMPLETES_TTL_MS = 10 * 60_000;

async function ensureCompletes(): Promise<CompletedDeal[] | null> {
  if (completesCache && Date.now() - completesCache.at < COMPLETES_TTL_MS) {
    return completesCache.completes;
  }
  if (!completesCache) {
    // v2 snapshot key — v1 lacked propertyUuid; a clean re-pull fills it.
    const snap = await loadSnapshot<CompletedDeal[]>("completes-v2");
    if (snap) {
      completesCache = { at: snap.savedAt, completes: snap.data };
      if (Date.now() - snap.savedAt < COMPLETES_TTL_MS) return completesCache.completes;
    }
  }
  const rows = await listAll("/api/v1/deals?tenancy_status=complete", 40);
  if (!rows) return completesCache?.completes ?? null;
  completesCache = {
    at: Date.now(),
    completes: rows.map((r) => ({
      date: typeof r.move_in_date === "string" ? r.move_in_date : null,
      service:
        typeof r.tenancy_service_level === "string" ? r.tenancy_service_level : null,
      propertyUuid: typeof r.property_uuid === "string" ? r.property_uuid : null,
    })),
  };
  void saveSnapshot("completes-v2", completesCache.completes);
  return completesCache.completes;
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Count of completed move-ins for one agent with a move-in date in
 * [start, end] (inclusive ISO dates) — powers ramp-time reporting. Matches
 * the deal's property manager by email, then by normalised name (new
 * starters aren't in the static roster, so we compare names directly rather
 * than via a roster slug). null = Propoly unconfigured/unreachable.
 */
export async function getAgentMoveInsInWindow(
  ref: { email?: string | null; name?: string | null },
  start: string,
  end: string
): Promise<number | null> {
  if (!propolyConfigured()) return null;
  const email = ref.email?.trim().toLowerCase() || null;
  const name = ref.name ? normName(ref.name) : null;
  if (!email && !name) return 0;
  const work = (async () => {
    const [completes, managerMap] = await Promise.all([
      ensureCompletes(),
      propertyManagers(),
    ]);
    if (!completes) return null;
    let count = 0;
    for (const c of completes) {
      if (!c.date || c.date < start || c.date > end) continue;
      const mgr = c.propertyUuid ? managerMap?.get(c.propertyUuid) : undefined;
      if (!mgr) continue;
      const byEmail = email != null && mgr.email === email;
      const byName = !byEmail && name != null && mgr.name != null && normName(mgr.name) === name;
      if (byEmail || byName) count += 1;
    }
    return count;
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

/**
 * RLP conversion input: this month's completed move-ins split by service
 * level. RLP = fully-managed share of move-ins (Susan's "x of y EFM managed").
 */
export async function getPropolyRlpMtd(
  month: string
): Promise<{ total: number; fullyManaged: number } | null> {
  if (!propolyConfigured()) return null;
  const completes = await ensureCompletes().catch(() => null);
  if (!completes) return null;
  const inMonth = completes.filter((c) => c.date?.startsWith(month));
  return {
    total: inMonth.length,
    fullyManaged: inMonth.filter((c) => c.service === "full_managed").length,
  };
}

/**
 * Completed move-ins with a move-in date inside [start, end] (ISO dates,
 * inclusive). Powers historic months and the like-for-like YoY comparison —
 * Propoly's history reaches back to 2023. null when unreachable.
 *
 * Definition note: counts deals that ran through Propoly. Susan's Move-In
 * Report also counts managed transfers + marketing-only move-ins, so her
 * months run higher (June 2026: Propoly 21 vs her 30, of which ~10 were
 * transfers/marketing-only per her own notes).
 */
export async function getPropolyMoveInsInRange(
  start: string,
  end: string
): Promise<number | null> {
  if (!propolyConfigured()) return null;
  const work = (async () => {
    const completes = await ensureCompletes();
    if (!completes) return null;
    return completes.filter((c) => c.date != null && c.date >= start && c.date <= end)
      .length;
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

/**
 * Whole-business Propoly aggregates for Susan's dashboard: the live
 * progression pipeline broken down by stage, and completed move-ins for a
 * month. null when unconfigured/unreachable so callers keep the snapshot.
 */
export async function getPropolyBusinessStats(
  month: string
): Promise<PropolyBusinessStats | null> {
  if (!propolyConfigured()) return null;

  const work = (async (): Promise<PropolyBusinessStats | null> => {
    const deals = await fetchAllDeals();
    if (!deals) return null;

    await ensureCompletes();

    const active = deals.filter((d) => d.statusKey !== "cancelled");
    return {
      month,
      pipelineTotal: active.length,
      pipelineByStage: ACTIVE_STATUSES.map((key) => ({
        key,
        label: STATUS_INFO[key].label,
        count: active.filter((d) => d.statusKey === key).length,
      })),
      moveInsThisMonth: (completesCache?.completes ?? []).filter((c) =>
        c.date?.startsWith(month)
      ).length,
      generatedAt: new Date().toISOString(),
    };
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

/* ------------------------- move-in tracker (admin) ------------------------ */

export interface PropolyMoveInForecast {
  /** Completed move-ins, 1st of this month → today. */
  completedMtd: number;
  /** Completed move-ins, same day-window last month (for the trend arrow). */
  completedPrevMtd: number;
  /** ACTIVE deals (not complete/cancelled) by move-in month, this month +3. */
  forecastByMonth: Record<string, number>;
  /** Active deals with a move-in date already passed — slipping, need a chase. */
  forecastOverdue: number;
  /** Active deals with no move-in date set yet. */
  forecastUndated: number;
  pipelineTotal: number;
  /** Completed per calendar month, current year (fuels quarter sums). */
  completedByMonth: Record<string, number>;
  ytd: number;
  prevYtd: number; // same window last year
  generatedAt: string;
}

export async function getPropolyMoveInForecast(): Promise<PropolyMoveInForecast | null> {
  if (!propolyConfigured()) return null;

  const work = (async (): Promise<PropolyMoveInForecast | null> => {
    const [completes, deals] = await Promise.all([ensureCompletes(), fetchAllDeals()]);
    if (!completes && !deals) return null;

    const today = new Date().toISOString().slice(0, 10);
    const year = today.slice(0, 4);
    const month = today.slice(0, 7);
    const day = today.slice(8, 10);
    const prevMonthDate = new Date();
    prevMonthDate.setUTCMonth(prevMonthDate.getUTCMonth() - 1);
    const prevMonth = prevMonthDate.toISOString().slice(0, 7);

    const completed = (completes ?? [])
      .map((c) => c.date)
      .filter((d): d is string => d != null);
    const completedByMonth: Record<string, number> = {};
    for (const d of completed) {
      if (d.startsWith(year)) {
        const m = d.slice(0, 7);
        completedByMonth[m] = (completedByMonth[m] ?? 0) + 1;
      }
    }

    // Forecast: active deals by move-in month, this month → +3.
    const horizon: string[] = [];
    const cursor = new Date(`${month}-01T00:00:00Z`);
    for (let i = 0; i < 4; i++) {
      horizon.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    const forecastByMonth: Record<string, number> = Object.fromEntries(
      horizon.map((m) => [m, 0])
    );
    let forecastOverdue = 0;
    let forecastUndated = 0;
    const active = (deals ?? []).filter(
      (d) => d.statusKey !== "cancelled" && d.statusKey !== "complete"
    );
    for (const d of active) {
      const mi = d.app.startDate;
      if (!mi) {
        forecastUndated += 1;
      } else if (mi < today) {
        forecastOverdue += 1;
      } else {
        const m = mi.slice(0, 7);
        if (m in forecastByMonth) forecastByMonth[m] += 1;
      }
    }

    return {
      completedMtd: completed.filter((d) => d >= `${month}-01` && d <= today).length,
      completedPrevMtd: completed.filter(
        (d) => d >= `${prevMonth}-01` && d <= `${prevMonth}-${day}`
      ).length,
      forecastByMonth,
      forecastOverdue,
      forecastUndated,
      pipelineTotal: active.length,
      completedByMonth,
      ytd: completed.filter((d) => d >= `${year}-01-01` && d <= today).length,
      prevYtd: completed.filter(
        (d) => d >= `${Number(year) - 1}-01-01` && d <= `${Number(year) - 1}${today.slice(4)}`
      ).length,
      generatedAt: new Date().toISOString(),
    };
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
