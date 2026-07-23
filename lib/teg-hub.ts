// TEG Team Hub connector — the group-wide people database (Base44 app).
// One endpoint, action-based: POST https://teg-team-hub.base44.app/functions/dbApi
// with an `x-api-secret` header. Entities: TeamMember, Brand, Company,
// Location, Role, Note, SyncLog, User.
//
// We only READ from it (search/list) — it is the source of truth for who is a
// live TLE partner, so it powers the Agent Headcount section live. The secret
// grants full read/write to sensitive records (bank details, HMRC UTRs), so
// this module is server-only and the secret never leaves env vars.
import "server-only";

const BASE_URL =
  process.env.TEG_HUB_API_BASE ?? "https://teg-team-hub.base44.app/functions/dbApi";

function secret(): string | undefined {
  return process.env.TEG_HUB_API_SECRET ?? process.env.TEG_HUB_SECRET;
}

export function tegHubConfigured(): boolean {
  return Boolean(secret());
}

interface TegResponse<T> {
  success: boolean;
  action?: string;
  entity?: string;
  data?: T;
  error?: string;
}

export async function tegHubCall<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const key = secret();
  if (!key) throw new Error("TEG Hub not configured (set TEG_HUB_API_SECRET)");
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "x-api-secret": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  const json = (await res.json().catch(() => null)) as TegResponse<T> | null;
  if (!res.ok || !json?.success) {
    throw new Error(`TEG Hub ${body.action}/${body.entity} failed (${res.status}): ${json?.error ?? "no body"}`);
  }
  return json.data as T;
}

/* ------------------------------- entities -------------------------------- */

export interface TegTeamMember {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  person_type?: string; // "Partner" | "Support Staff"
  primary_brand_id?: string;
  sub_brands?: string[];
  employment_type?: string;
  active?: boolean;
  status?: string; // Pre Compliant | Onboarded | Trading | On Hold | Departed | Onboarding | Active | On Leave | Duplicate
  trading_name?: string;
  partner_package?: string;
  location_id?: string;
  territory_postcodes?: string[];
  date_signed?: string;
  date_compliant?: string;
  date_launched?: string;
  leave_date?: string;
  leave_reason?: string;
  rex_id?: number;
  rex_account_id?: string;
  created_date?: string;
}

export interface TegBrand {
  id: string;
  name: string;
  short_code?: string;
  active?: boolean;
  selectable?: boolean;
}

export interface TegLocation {
  id: string;
  name: string;
}

const TM_FIELDS = [
  "id",
  "first_name",
  "last_name",
  "email",
  "person_type",
  "primary_brand_id",
  "sub_brands",
  "active",
  "status",
  "trading_name",
  "partner_package",
  "location_id",
  "date_signed",
  "date_launched",
  "leave_date",
  "rex_id",
];

/* ------------------------------ headcount -------------------------------- */

// Calibrated against real hub data (21 Jul 2026): TLE-primary partners carry
// status "Active"/"Departed"; dual-brand partners (primary TPE/Prestige with
// TLE in sub_brands) mostly have NO status — active:true is their signal.
const TRADING_STATUSES = new Set(["Trading", "Active"]);
const EXCLUDED_STATUSES = new Set(["Departed", "Duplicate"]);
// Signed but not yet launched — Susan's "Starting Soon".
const PIPELINE_STATUSES = new Set(["Onboarding", "Onboarded", "Pre Compliant"]);

export interface TegAgent {
  name: string;
  email?: string;
  /** true = another Experts brand is primary, TLE is a sub-brand. */
  dual?: boolean;
  status?: string;
  package?: string;
  brand?: string;
  location?: string;
  dateLaunched?: string;
  leaveDate?: string;
  /** REX user id — the join key for ramp-time cross-referencing. */
  rexId?: number;
}

export interface TegHeadcount {
  activeAgents: number; // tlePrimary + tleDual
  tlePrimary: number; // primary brand = The Letting Experts, status Active
  tleDual: number; // other primary brand (TPE/Prestige…) with TLE in sub_brands
  byStatus: Record<string, number>;
  byPackage: Record<string, number>; // partner_package (Basic/Pro/Academy…), trading agents only
  startingSoon: number;
  startersYtd: number; // date_launched in the current year
  leaversYtd: number; // leave_date in the current year (Departed included)
  varianceYtd: number;
  agents: TegAgent[]; // trading + pipeline agents with locations
  brandNames: Record<string, string>;
  generatedAt: string;
}

let cache: { at: number; data: TegHeadcount } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Live TLE headcount from the Team Hub. Counts PARTNERS on the TLE brand
 * family (primary brand name contains "letting"/"TLE") — the hub logs every
 * Experts Group brand, so we filter to ours. Best-effort on package splits:
 * partner_package when set, else the primary brand name.
 */
export async function getTegHeadcount(force = false): Promise<TegHeadcount | null> {
  if (!tegHubConfigured()) return null;
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const [brands, locations, partners, leavers] = await Promise.all([
    tegHubCall<TegBrand[]>({ action: "list", entity: "Brand", limit: 200 }),
    tegHubCall<TegLocation[]>({ action: "list", entity: "Location", limit: 500 }).catch(
      () => [] as TegLocation[]
    ),
    tegHubCall<TegTeamMember[]>({
      action: "search",
      entity: "TeamMember",
      query: { person_type: "Partner", active: true },
      fields: TM_FIELDS,
      limit: 2000,
    }),
    // Leavers drop off active=true, so query them separately by leave_date.
    tegHubCall<TegTeamMember[]>({
      action: "search",
      entity: "TeamMember",
      query: { person_type: "Partner", leave_date: { $gte: yearStart() } },
      fields: TM_FIELDS,
      limit: 2000,
    }).catch(() => [] as TegTeamMember[]),
  ]);

  const brandNames: Record<string, string> = {};
  for (const b of brands ?? []) brandNames[b.id] = b.name;
  const locationNames: Record<string, string> = {};
  for (const l of locations ?? []) locationNames[l.id] = l.name;

  // "The Letting Experts" brand id — matched by name so a Base44 re-seed
  // can't silently break us.
  const isTleBrand = (id?: string) => {
    const n = (id && brandNames[id])?.toLowerCase() ?? "";
    return n.includes("letting") && !n.includes("lite");
  };
  const tle = (partners ?? []).filter(
    (p) => isTleBrand(p.primary_brand_id) || (p.sub_brands ?? []).some(isTleBrand)
  );

  const byStatus: Record<string, number> = {};
  const byPackage: Record<string, number> = {};
  const agents: TegAgent[] = [];
  let tlePrimary = 0;
  let tleDual = 0;
  let startingSoon = 0;
  let startersYtd = 0;

  const ys = yearStart();
  for (const p of tle) {
    const status = p.status?.trim() || "No status";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (EXCLUDED_STATUSES.has(status) || p.active === false) continue;

    const isPrimary = isTleBrand(p.primary_brand_id);
    // Primary-brand partners must be explicitly Active (status is maintained
    // for them); dual-brand partners rarely have a status — active:true counts.
    const counted = isPrimary
      ? TRADING_STATUSES.has(status) || status === "No status"
      : true;
    if (counted) {
      if (isPrimary) tlePrimary += 1;
      else tleDual += 1;
      const pkg = p.partner_package?.trim() || "Unlabelled";
      byPackage[pkg] = (byPackage[pkg] ?? 0) + 1;
    }
    if (PIPELINE_STATUSES.has(status)) startingSoon += 1;
    if (p.date_launched && p.date_launched >= ys) startersYtd += 1;
    if (counted || PIPELINE_STATUSES.has(status)) {
      agents.push({
        name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.trading_name || p.email || p.id,
        email: p.email,
        dual: !isPrimary,
        status,
        package: p.partner_package,
        brand: brandNames[p.primary_brand_id ?? ""],
        location: locationNames[p.location_id ?? ""],
        dateLaunched: p.date_launched,
        leaveDate: p.leave_date,
        rexId: p.rex_id,
      });
    }
  }

  const tleLeavers = (leavers ?? []).filter(
    (p) => isTleBrand(p.primary_brand_id) || (p.sub_brands ?? []).some(isTleBrand)
  );
  const leaversYtd = tleLeavers.length;

  const data: TegHeadcount = {
    activeAgents: tlePrimary + tleDual,
    tlePrimary,
    tleDual,
    byStatus,
    byPackage,
    startingSoon,
    startersYtd,
    leaversYtd,
    varianceYtd: startersYtd - leaversYtd,
    agents: agents.sort((a, b) => a.name.localeCompare(b.name)),
    brandNames,
    generatedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), data };
  return data;
}

function yearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}
