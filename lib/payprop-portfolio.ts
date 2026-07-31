import "server-only";
import { payPropAccounts, payPropGetAll, type PayPropAccountId } from "@/lib/payprop";
import { readCache, writeCache } from "@/lib/integration-cache";

// The managed book out of PayProp, attributable to the partner who runs each
// property. PayProp names them in `responsible_agent` — a free-text name, not
// an id, so matching is by normalised name and has to be careful: attributing
// someone else's portfolio or arrears to the wrong partner is the kind of
// error that looks perfectly plausible on screen.
//
// Note this is the MANAGED book (money flowing through PayProp), which is a
// different population from the REX listings the dashboard's portfolio mix
// counts. The two are not meant to agree.

export interface PropertyRow {
  id?: string;
  property_name?: unknown;
  responsible_agent?: unknown;
  responsible_agent_id?: string;
  monthly_payment_required?: number;
  contract_amount?: number;
  commission?: number;
  service_level?: unknown;
  active_tenancies?: number;
  account_balance?: number;
  address?: { first_line?: string; city?: string; postal_code?: string };
}

/**
 * Names that appear in `responsible_agent` but aren't a person: office
 * buckets, service labels and blanks. Counted separately so the totals still
 * add up rather than being quietly dropped.
 */
const NON_AGENT = new Set([
  "(none)",
  "tle",
  "admin property",
  "fully managed",
  "howard",
]);

/** Lowercased, punctuation flattened, parentheticals removed. */
export function normaliseAgentName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ") // "Sean McMahon (Edinburgh)" → "sean mcmahon"
    .replace(/[^a-z\s]/g, " ") // hyphens: "Wilson-Slight" → "wilson slight"
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A join key for a property, built from its address.
 *
 * PayProp names the same property differently between reports — the properties
 * export says "Belgrave, 7" while the move-ins report says "11 Albion Street,
 * Motherwell" — and move-in rows carry no id at all. What both always contain
 * is a house number and a street, so the key is those two: the number plus the
 * first real word of the street name.
 *
 * Deliberately loose. It will collide for the same number and street in two
 * towns, so it's only ever used as a fallback behind an id match.
 */
export function propertyKey(name: string): string {
  const cleaned = String(name ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);
  const number = words.find((w) => /^\d+$/.test(w));
  const street = words.find((w) => /^[a-z]{3,}$/.test(w) && !STREET_NOISE.has(w));
  return number && street ? `${number}|${street}` : "";
}

/** Words that appear in every address and so identify nothing. */
const STREET_NOISE = new Set([
  "flat", "room", "apt", "apartment", "unit", "the", "street", "road", "avenue",
  "close", "court", "place", "drive", "lane", "way", "gardens", "rest",
]);

export interface AgentBook {
  /** As PayProp spells it, for showing back to a human. */
  names: string[];
  properties: number;
  /** Rent under management per month. */
  rentRoll: number;
  /** Tenancies currently running across those properties. */
  activeTenancies: number;
  /** Property names on this book — how arrears rows get attributed, since
   *  tenant balances name the property rather than the agent. */
  propertyNames: string[];
  /** PayProp ids for the same properties. Names are formatted differently
   *  between reports, so anything joining across reports uses these. */
  propertyIds: string[];
  /** Address-derived keys, for reports that carry no id (see propertyKey). */
  propertyKeys: string[];
  accounts: PayPropAccountId[];
}

export interface AccountSlice {
  account: PayPropAccountId;
  label: string;
  properties: number;
  rentRoll: number;
  /** Mean rent across that account's properties. */
  avgRent: number;
}

export interface PortfolioBook {
  /** Every managed property, business-wide. */
  totalProperties: number;
  totalRentRoll: number;
  /** Mean rent across the whole book. */
  avgRent: number;
  /** Properties with no tenancy running — the vacancy figure. */
  vacant: number;
  /** Tenanted properties (active_tenancies > 0). */
  tenanted: number;
  /** Counts per PayProp service level, e.g. Fully Managed vs Let Only. */
  byServiceLevel: Array<{ level: string; properties: number; rentRoll: number }>;
  /** E&W and Glasgow are separate agencies — split so both can be shown. */
  byAccount: AccountSlice[];
  /** Keyed by normalised name. */
  byAgent: Record<string, AgentBook>;
  /** Properties on buckets that aren't a person (TLE, Admin Property, blank). */
  unattributed: number;
  accounts: PayPropAccountId[];
}

/**
 * Free-text PayProp fields, coerced safely. They're documented as strings but
 * arrive as objects ({name}/{description}) or numbers on some properties, and
 * assuming otherwise took the whole portfolio walk down.
 */
const text = (v: unknown): string => {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["name", "description", "label", "value"]) {
      if (typeof o[k] === "string") return (o[k] as string).trim();
    }
  }
  return "";
};

const money = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

let cache: { at: number; data: PortfolioBook } | null = null;
let running = false;
const TTL_MS = 60 * 60_000;

// Why the last walk failed. It was being caught and discarded, which left the
// tab on "fetching…" forever with nothing anywhere saying why.
let lastError: string | null = null;
export function portfolioError(): string | null {
  return lastError;
}

/**
 * The managed book, grouped by responsible agent. Non-blocking in the same way
 * as the income figures: serves what's cached and refreshes behind.
 */
export function getPortfolioBook(): PortfolioBook | null {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (!running) {
    running = true;
    void (async () => {
      // Survive a deploy: the last good book is in the database.
      if (!cache) {
        const stored = await readCache<PortfolioBook>("payprop:portfolio:v2").catch(() => null);
        if (stored) {
          cache = { at: stored.at, data: stored.data };
          if (Date.now() - stored.at < TTL_MS) return;
        }
      }
      const data = await computePortfolioBook();
      if (data) {
        cache = { at: Date.now(), data };
        lastError = null;
        await writeCache("payprop:portfolio:v2", data);
      } else {
        lastError = "PayProp returned no properties.";
      }
    })()
      .catch((e: unknown) => {
        lastError = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        running = false;
      });
  }
  return cache?.data ?? null;
}

async function computePortfolioBook(): Promise<PortfolioBook | null> {
  const accounts = payPropAccounts();
  if (accounts.length === 0) return null;

  const perAccount: Array<{ account: PayPropAccountId; rows: PropertyRow[] }> = [];
  for (const a of accounts) {
    try {
      perAccount.push({
        account: a,
        rows: await payPropGetAll<PropertyRow>(a, "export/properties", {
          is_archived: "false",
          include_active_tenancies: "true",
          include_contract_amount: "true",
        }),
      });
    } catch (e) {
      // One agency short means the business-wide total would be wrong, so the
      // whole book fails — but say which agency, so it's diagnosable.
      throw new Error(`${a}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (perAccount.every((p) => p.rows.length === 0)) return null;

  const byAgent: Record<string, AgentBook> = {};
  let totalProperties = 0;
  let totalRentRoll = 0;
  let unattributed = 0;
  let vacant = 0;
  let tenanted = 0;
  const levels = new Map<string, { properties: number; rentRoll: number }>();
  const slices: AccountSlice[] = [];

  for (const { account, rows } of perAccount) {
    let accProperties = 0;
    let accRent = 0;
    for (const r of rows) {
      // contract_amount is the agreed rent; monthly_payment_required is what's
      // actually collected each month. Prefer the latter, fall back.
      const rent = money(r.monthly_payment_required) || money(r.contract_amount);
      totalProperties++;
      totalRentRoll += rent;
      accProperties++;
      accRent += rent;

      // A property with no running tenancy is a void.
      if (money(r.active_tenancies) > 0) tenanted++;
      else vacant++;

      // PayProp's own service level — how "managed" vs "let only" is decided,
      // rather than us inferring it.
      const level = text(r.service_level) || "Not set";
      const lv = levels.get(level) ?? { properties: 0, rentRoll: 0 };
      lv.properties++;
      lv.rentRoll += rent;
      levels.set(level, lv);

      const raw = text(r.responsible_agent);
      const key = normaliseAgentName(raw);
      if (!key || NON_AGENT.has(key)) {
        unattributed++;
        continue;
      }

      const book = (byAgent[key] ??= {
        names: [],
        properties: 0,
        rentRoll: 0,
        activeTenancies: 0,
        propertyNames: [],
        propertyIds: [],
        propertyKeys: [],
        accounts: [],
      });
      if (raw && !book.names.includes(raw)) book.names.push(raw);
      book.properties++;
      book.rentRoll += rent;
      book.activeTenancies += money(r.active_tenancies);
      const pname = text(r.property_name);
      if (pname) book.propertyNames.push(pname);
      const pid = text(r.id);
      if (pid) book.propertyIds.push(pid);
      const pkey = propertyKey(pname || text(r.address?.first_line));
      if (pkey) book.propertyKeys.push(pkey);
      if (!book.accounts.includes(account)) book.accounts.push(account);
    }
    slices.push({
      account,
      label: account === "scotland" ? "Glasgow" : "E&W",
      properties: accProperties,
      rentRoll: accRent,
      avgRent: accProperties ? accRent / accProperties : 0,
    });
  }

  return {
    totalProperties,
    totalRentRoll,
    avgRent: totalProperties ? totalRentRoll / totalProperties : 0,
    vacant,
    tenanted,
    byServiceLevel: [...levels.entries()]
      .map(([level, v]) => ({ level, ...v }))
      .sort((a, b) => b.properties - a.properties),
    byAccount: slices,
    byAgent,
    unattributed,
    accounts,
  };
}

/**
 * One partner's slice of the managed book, matched on their portal name.
 * Returns null when the book isn't loaded yet, so the caller can fall back
 * rather than show a confident zero.
 */
export function getAgentBook(displayName: string): AgentBook | null {
  const book = getPortfolioBook();
  if (!book) return null;
  const key = normaliseAgentName(displayName);
  return (
    book.byAgent[key] ?? {
      names: [],
      properties: 0,
      rentRoll: 0,
      activeTenancies: 0,
      propertyNames: [],
      propertyIds: [],
      propertyKeys: [],
      accounts: [],
    }
  );
}
