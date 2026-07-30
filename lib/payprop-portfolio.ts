import "server-only";
import { payPropAccounts, payPropGetAll, type PayPropAccountId } from "@/lib/payprop";

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
  property_name?: string;
  responsible_agent?: string;
  responsible_agent_id?: string;
  monthly_payment_required?: number;
  contract_amount?: number;
  commission?: number;
  service_level?: string;
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

const money = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

let cache: { at: number; data: PortfolioBook } | null = null;
let running = false;
const TTL_MS = 10 * 60_000;

/**
 * The managed book, grouped by responsible agent. Non-blocking in the same way
 * as the income figures: serves what's cached and refreshes behind.
 */
export function getPortfolioBook(): PortfolioBook | null {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (!running) {
    running = true;
    void computePortfolioBook()
      .then((data) => {
        if (data) cache = { at: Date.now(), data };
      })
      .catch(() => {})
      .finally(() => {
        running = false;
      });
  }
  return cache?.data ?? null;
}

async function computePortfolioBook(): Promise<PortfolioBook | null> {
  const accounts = payPropAccounts();
  if (accounts.length === 0) return null;

  const perAccount = await Promise.all(
    accounts.map(async (a) => ({
      account: a,
      rows: await payPropGetAll<PropertyRow>(a, "export/properties", {
        is_archived: "false",
        include_active_tenancies: "true",
        include_commission: "true",
        include_contract_amount: "true",
      }),
    }))
  );
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
      const level = (r.service_level ?? "").trim() || "Not set";
      const lv = levels.get(level) ?? { properties: 0, rentRoll: 0 };
      lv.properties++;
      lv.rentRoll += rent;
      levels.set(level, lv);

      const raw = (r.responsible_agent ?? "").trim();
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
        accounts: [],
      });
      if (raw && !book.names.includes(raw)) book.names.push(raw);
      book.properties++;
      book.rentRoll += rent;
      book.activeTenancies += money(r.active_tenancies);
      if (r.property_name) book.propertyNames.push(r.property_name);
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
      accounts: [],
    }
  );
}
