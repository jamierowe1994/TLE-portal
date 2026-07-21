import "server-only";
import { propolyConfigured, propolyGet } from "@/lib/propoly";
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

/** Fetch every page of a list endpoint (page 1 first, the rest in parallel). */
async function listAll(
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

  const [managerMap, ...statusLists] = await Promise.all([
    propertyManagers(),
    ...ACTIVE_STATUSES.map((s) => listAll(`/api/v1/deals?tenancy_status=${s}`, 8)),
    // Cancelled outnumber live 191:120 — one page feeds the hidden section.
    listAll("/api/v1/deals?tenancy_status=cancelled", 1),
  ]);
  const keys = [...ACTIVE_STATUSES, "cancelled"];
  if (statusLists.every((l) => l == null)) return null;

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
  return deals;
}

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

export interface PropolyUserRef {
  email: string;
  agentKey: string | null;
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

/** Count of the agent's deals actively progressing (excludes cancelled). */
export async function getPropolyPipelineCount(
  user: PropolyUserRef
): Promise<number | null> {
  const apps = await getPropolyAgentDeals(user);
  if (apps == null) return null;
  return apps.filter((a) => a.stage !== "unsuccessful").length;
}

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
let completesCache: { at: number; moveInDates: (string | null)[] } | null = null;
const COMPLETES_TTL_MS = 10 * 60_000;

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

    if (!completesCache || Date.now() - completesCache.at > COMPLETES_TTL_MS) {
      const rows = await listAll("/api/v1/deals?tenancy_status=complete", 40);
      if (rows) {
        completesCache = {
          at: Date.now(),
          moveInDates: rows.map((r) =>
            typeof r.move_in_date === "string" ? r.move_in_date : null
          ),
        };
      }
    }

    const active = deals.filter((d) => d.statusKey !== "cancelled");
    return {
      month,
      pipelineTotal: active.length,
      pipelineByStage: ACTIVE_STATUSES.map((key) => ({
        key,
        label: STATUS_INFO[key].label,
        count: active.filter((d) => d.statusKey === key).length,
      })),
      moveInsThisMonth: (completesCache?.moveInDates ?? []).filter((d) =>
        d?.startsWith(month)
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
