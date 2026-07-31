import "server-only";
import { payPropAccounts, payPropGetAll, type PayPropAccountId } from "@/lib/payprop";
import { readCache, writeCache } from "@/lib/integration-cache";
import { normaliseAgentName, propertyKey } from "@/lib/payprop-portfolio";

// Live money out of PayProp, replacing the figures the admin centre has been
// reading off the 11 Jul 2026 dashboard snapshot.
//
// The obvious endpoint for this — /report/agency/income — needs the
// `read:report:agency-income` scope, which our OAuth client wasn't granted.
// /report/all-payments was, and it carries the same money at a finer grain:
// every payment with its category and who it went to. The agency's own slice
// (beneficiary.type === "agency") IS the commission, so GCI is a sum rather
// than a report we're missing. Verified against July 2026: 1,039 payments,
// £19,804.02 to the agency.

export interface PaymentRow {
  amount?: string;
  category?: { id?: string; name?: string };
  beneficiary?: { id?: string; name?: string; type?: string };
  due_date?: string;
  description?: string;
}

export interface AgencyIncome {
  month: string;
  /** Commission the agency itself kept — TLE's net share. */
  agencyIncome: number;
  /** Every fee charged, whoever received it: the agency's share plus the
   *  partners'. This is the business's gross commission income. */
  combinedGci: number;
  /** Partners who earned a fee this month — the honest denominator for
   *  "per agent", rather than everyone on the roster. */
  agentsEarning: number;
  /** Fees paid out to associates/partners rather than kept by the agency. */
  paidToBeneficiaries: number;
  /** Rent passed through to landlords — not income, but the volume behind it. */
  ownerPayments: number;
  /** Money moved that isn't rent and isn't a fee: contractor costs, deposits,
   *  refunds, uncategorised. Reported so the total is accounted for. */
  unclassified: number;
  /** Agency income split by fee type, biggest first. */
  byCategory: Array<{ category: string; amount: number }>;
  /** What each partner earned this month, biggest first. */
  byPartner: Array<{ name: string; amount: number; payments: number }>;
  /** GCI per agency — the Income tab shows E&W and Glasgow separately. */
  byAccount: Array<{ account: PayPropAccountId; label: string; agencyIncome: number; combinedGci: number }>;
  paymentCount: number;
  accounts: PayPropAccountId[];
}

// Walking a month of payments is ~40 sequential requests, so hold the result —
// the admin centre re-renders far more often than the money moves. An hour is
// comfortably fresh for figures that change when payments run.
const TTL_MS = 60 * 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

const running = new Set<string>();

/**
 * Serve what we have and refresh behind the scenes. A month of payments is
 * ~40 sequential requests (PayProp rate-limits, so they can't be parallel),
 * which is far too slow to block an admin page on. The first call returns
 * null and starts the walk; once it lands every later call is instant.
 */
/** Bump when a cached shape gains or loses a field. */
const CACHE_VERSION = "v3";

function cachedAsync<T>(rawKey: string, run: () => Promise<T>): T | null {
  const key = `${CACHE_VERSION}:${rawKey}`;
  return cachedAsyncInner(key, run);
}

function cachedAsyncInner<T>(key: string, run: () => Promise<T>): T | null {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T;

  if (!running.has(key)) {
    running.add(key);
    void (async () => {
      // On a cold process, the database usually already holds the answer from
      // before the last deploy — serve that immediately rather than making
      // everyone wait out a fresh walk.
      if (!hit) {
        const stored = await readCache<T>(key).catch(() => null);
        if (stored) {
          cache.set(key, { at: stored.at, data: stored.data });
          if (Date.now() - stored.at < TTL_MS) return; // still fresh — done
        }
      }
      const data = await run();
      cache.set(key, { at: Date.now(), data });
      await writeCache(key, data);
    })()
      .catch(() => {})
      .finally(() => running.delete(key));
  }
  // Stale beats nothing while the refresh is in flight.
  return (hit?.data as T) ?? null;
}

/** True when a background walk is in progress, so the UI can say "updating". */
export function payPropRefreshing(): boolean {
  return running.size > 0;
}

/**
 * The fee categories that ARE commission. Deliberately an allowlist: naming
 * what to exclude let real money through that isn't income at all. Checked
 * against July 2026, where a denylist counted a £1,850 "Tenant Refund" and
 * £11,241 of ambiguous "Other" (admin fees) as GCI, inflating it from
 * £46,705 to £60,073 and pushing GCI per move-in to £2,612 against a
 * historical £2,201. On the allowlist it lands at £2,031.
 */
const FEE_CATEGORIES = new Set([
  "Management Fee",
  "First Month Management Fee",
  "Set Up Fee",
  "Management Fee - Investor Services",
  "Rent and Legal Protection",
]);

// Money that only passes through a recipient — never commission. Still used
// to separate an agent's pass-through from their earnings.
const NOT_EARNINGS = new Set(["Contractor", "Deposit (Custodial)", "Property account"]);

const money = (v: unknown) => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * The payments report for a date range, fetched once and shared.
 *
 * The admin income figures and a single partner's earnings were each doing
 * their own full walk of the same 1,280 rows — the partner's only to filter
 * down to their own. Now the first caller does the work, anyone asking while
 * it's in flight waits on the same promise rather than starting a competing
 * walk, and the result is reused for the rest of the hour.
 */
const RANGE_TTL_MS = 60 * 60_000;
type AccountRows = Array<{ account: PayPropAccountId; rows: PaymentRow[] }>;
const rangeCache = new Map<string, { at: number; data: AccountRows }>();
const rangeInflight = new Map<string, Promise<AccountRows>>();

async function paymentsForRange(from: string, to: string): Promise<AccountRows> {
  const key = `${from}|${to}`;
  const hit = rangeCache.get(key);
  if (hit && Date.now() - hit.at < RANGE_TTL_MS) return hit.data;

  const inflight = rangeInflight.get(key);
  if (inflight) return inflight;

  const job = (async () => {
    const accounts = payPropAccounts();
    const out: AccountRows = [];
    // One account after the other: both share the same rate limit, so running
    // them together just doubles the requests per second.
    for (const a of accounts) {
      out.push({
        account: a,
        rows: await payPropGetAll<PaymentRow>(a, "report/all-payments", {
          from_date: from,
          to_date: to,
        }),
      });
    }
    return out;
  })();

  rangeInflight.set(key, job);
  try {
    const data = await job;
    rangeCache.set(key, { at: Date.now(), data });
    // Only a couple of ranges are ever live at once (this month, last month,
    // year to date) — don't let this grow unbounded.
    if (rangeCache.size > 6) {
      const oldest = [...rangeCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) rangeCache.delete(oldest[0]);
    }
    return data;
  } finally {
    rangeInflight.delete(key);
  }
}

/** Last day of a YYYY-MM, so the range covers the whole month. */
function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/**
 * What the agency actually earned in a month, summed across every connected
 * PayProp account (the business runs Scotland and the rest of the UK as
 * separate agencies).
 */
export function getAgencyIncome(month: string): AgencyIncome | null {
  const { from, to } = monthRange(month);
  return cachedAsync(`income:${month}`, () => computeIncomeRange(month, from, to));
}

/**
 * Everything earned from 1 January up to the end of `month` — the year-to-date
 * figures on the admin home. One range query, not one per month.
 */
export function getYtdIncome(month: string): AgencyIncome | null {
  const { to } = monthRange(month);
  const year = month.slice(0, 4);
  return cachedAsync(`ytd:${month}`, () =>
    computeIncomeRange(`${year} YTD`, `${year}-01-01`, to)
  );
}

async function computeIncomeRange(
  label: string,
  from: string,
  to: string
): Promise<AgencyIncome | null> {
  const accounts = payPropAccounts();
  if (accounts.length === 0) return null;

  const perAccount = await paymentsForRange(from, to);
  const rows = perAccount.flatMap((p) => p.rows);
  if (rows.length === 0) return null;

  // Same classification per agency, so the parts sum to the whole.
  const sliceOf = (list: PaymentRow[]) => {
    let agency = 0;
    let partners = 0;
    for (const r of list) {
      const amt = money(r.amount);
      const cat = r.category?.name ?? "Other";
      if (!FEE_CATEGORIES.has(cat)) continue;
      const t = r.beneficiary?.type;
      if (t === "agency") agency += amt;
      else if (t === "beneficiary" || t === "global_beneficiary") partners += amt;
    }
    return { agencyIncome: agency, combinedGci: agency + partners };
  };
  const byAccount = perAccount.map((p) => ({
    account: p.account,
    label: p.account === "scotland" ? "Glasgow" : "E&W",
    ...sliceOf(p.rows),
  }));

  let agencyIncome = 0;
  let paidToBeneficiaries = 0;
  let ownerPayments = 0;
  let unclassified = 0;
  const cats = new Map<string, number>();
  // Distinct partners who took a fee, for the per-agent figure.
  const earners = new Set<string>();
  const partners = new Map<string, { amount: number; payments: number }>();

  for (const r of rows) {
    const amount = money(r.amount);
    const type = r.beneficiary?.type;
    const category = r.category?.name ?? "Other";

    if (category === "Owner") {
      ownerPayments += amount;
    } else if (!FEE_CATEGORIES.has(category)) {
      // Contractor costs, deposits, refunds, uncategorised — real money, but
      // not commission. Kept visible so the total is accounted for.
      unclassified += amount;
    } else if (type === "agency") {
      agencyIncome += amount;
      cats.set(category, (cats.get(category) ?? 0) + amount);
    } else if (type === "beneficiary" || type === "global_beneficiary") {
      // The partners' share of the same fees.
      paidToBeneficiaries += amount;
      if (r.beneficiary?.id) earners.add(r.beneficiary.id);
      const who = r.beneficiary?.name?.trim();
      if (who) {
        const p = partners.get(who) ?? { amount: 0, payments: 0 };
        p.amount += amount;
        p.payments++;
        partners.set(who, p);
      }
    }
  }

  return {
    month: label,
    agencyIncome,
    combinedGci: agencyIncome + paidToBeneficiaries,
    agentsEarning: earners.size,
    paidToBeneficiaries,
    ownerPayments,
    unclassified,
    byCategory: [...cats.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    byPartner: [...partners.entries()]
      .map(([name, v]) => ({ name, amount: v.amount, payments: v.payments }))
      .sort((a, b) => b.amount - a.amount),
    byAccount,
    paymentCount: rows.length,
    accounts,
  };
}

/* --------------------------------- arrears -------------------------------- */

export interface TenantBalanceRow {
  balance?: string;
  tenant?: { id?: string; name?: string; is_active?: boolean };
  property?: { id?: string; name?: string; is_active?: boolean };
  last_payment?: { date?: string };
  last_invoice?: { amount?: string; date?: string };
}

export interface ArrearsSummary {
  /** Tenants in debit, worst first. */
  tenants: Array<{
    tenant: string;
    property: string;
    /** PayProp property id — lets arrears be attributed to a partner. */
    propertyId: string | null;
    owed: number;
    lastInvoice: string | null;
  }>;
  totalOwed: number;
  /** How many tenancies were checked, so a count can be shown honestly. */
  checked: number;
  /** Split by agency — E&W and Glasgow are separate PayProp accounts. */
  byAccount: Array<{ account: PayPropAccountId; label: string; tenants: number; owed: number }>;
  /** Largest single debt, and the mean — both asked for on the arrears tab. */
  largest: number;
  average: number;
}

/**
 * Who's behind on rent. PayProp signs balances from the tenant's side, so a
 * negative balance is money owed — flipped here so the admin reads positives.
 */
export function getArrears(): ArrearsSummary | null {
  return cachedAsync("arrears", computeArrears);
}

async function computeArrears(): Promise<ArrearsSummary | null> {
  const accounts = payPropAccounts();
  if (accounts.length === 0) return null;

  const perAccount = await Promise.all(
    accounts.map(async (a) => ({
      account: a,
      rows: await payPropGetAll<TenantBalanceRow>(a, "report/tenant/balances"),
    }))
  );
  const rows = perAccount.flatMap((p) => p.rows);
  if (rows.length === 0) return null;

  // Same rule per agency, so the parts sum to the whole.
  const inArrears = (list: TenantBalanceRow[]) =>
    list.map((r) => -money(r.balance)).filter((owed) => owed > 0.005);
  const byAccount = perAccount.map((p) => {
    const owedList = inArrears(p.rows);
    return {
      account: p.account,
      label: p.account === "scotland" ? "Glasgow" : "E&W",
      tenants: owedList.length,
      owed: owedList.reduce((s, x) => s + x, 0),
    };
  });

  const tenants = rows
    .map((r) => ({
      tenant: r.tenant?.name ?? "Unknown",
      property: r.property?.name ?? "—",
      propertyId: r.property?.id ?? null,
      owed: -money(r.balance), // negative balance = in arrears
      lastInvoice: r.last_invoice?.date ?? null,
    }))
    .filter((t) => t.owed > 0.005)
    .sort((a, b) => b.owed - a.owed);

  const totalOwed = tenants.reduce((t, x) => t + x.owed, 0);
  return {
    tenants,
    totalOwed,
    checked: rows.length,
    byAccount,
    largest: tenants.length ? tenants[0].owed : 0,
    average: tenants.length ? totalOwed / tenants.length : 0,
  };
}

/* ---------------------------- one agent's money --------------------------- */

// TLE's partners are beneficiaries in PayProp, carrying their
// @thelettingexperts.co.uk address — the same address they sign into the
// portal with, which makes email the join key. Their commission is simply the
// payments made to them, minus the categories that aren't earnings
// (contractor reimbursements and deposit movements pass through them).


export interface AgentEarnings {
  month: string;
  /** What they earned — fees only. */
  earned: number;
  /** Money that merely passed through them, kept separate so it can be shown. */
  passedThrough: number;
  byCategory: Array<{ category: string; amount: number }>;
  paymentCount: number;
  /** False when no PayProp beneficiary matches this partner at all. */
  matched: boolean;
  /** Which key found them — worth showing, since name is the looser one. */
  matchedBy?: "email" | "name";
}

interface BeneficiaryRow {
  id?: string;
  first_name?: string;
  last_name?: string;
  business_name?: string;
  email_address?: string;
}

/**
 * Beneficiary ids indexed by email AND by name. Email is the better key — it's
 * unique and deliberate — but a partner whose PayProp address differs from the
 * one they sign in with would silently earn nothing, which is worse than a
 * slightly fuzzier match. Name is the fallback, never the first choice.
 */
let beneficiaryCache: { at: number; data: BeneficiaryIndex } | null = null;
let beneficiaryInflight: Promise<BeneficiaryIndex> | null = null;

interface BeneficiaryIndex {
  byEmail: Map<string, Set<string>>;
  byName: Map<string, Set<string>>;
}

async function beneficiaryIndex(): Promise<BeneficiaryIndex> {
  // Every partner loading their dashboard was walking the whole directory.
  // It changes when someone joins, not by the minute.
  if (beneficiaryCache && Date.now() - beneficiaryCache.at < RANGE_TTL_MS) {
    return beneficiaryCache.data;
  }
  if (beneficiaryInflight) return beneficiaryInflight;
  beneficiaryInflight = buildBeneficiaryIndex();
  try {
    const data = await beneficiaryInflight;
    if (data.byEmail.size || data.byName.size) {
      beneficiaryCache = { at: Date.now(), data };
    }
    return data;
  } finally {
    beneficiaryInflight = null;
  }
}

async function buildBeneficiaryIndex(): Promise<BeneficiaryIndex> {
  const accounts = payPropAccounts();
  const rows = (
    await Promise.all(
      accounts.map((a) => payPropGetAll<BeneficiaryRow>(a, "export/beneficiaries"))
    )
  ).flat();

  const byEmail = new Map<string, Set<string>>();
  const byName = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, id: string) => {
    const set = map.get(key) ?? new Set<string>();
    set.add(id);
    map.set(key, set);
  };
  for (const b of rows) {
    if (!b.id) continue;
    const email = b.email_address?.trim().toLowerCase();
    if (email) add(byEmail, email, b.id);
    const full = [b.first_name, b.last_name].filter(Boolean).join(" ").trim();
    const name = normaliseAgentName(full || b.business_name || "");
    if (name) add(byName, name, b.id);
  }
  return { byEmail, byName };
}

/** email (lowercased) → PayProp beneficiary id, for every connected account. */
async function beneficiaryIdsByEmail(): Promise<Map<string, Set<string>>> {
  const accounts = payPropAccounts();
  const rows = (
    await Promise.all(
      accounts.map((a) =>
        payPropGetAll<BeneficiaryRow>(a, "export/beneficiaries")
      )
    )
  ).flat();

  const map = new Map<string, Set<string>>();
  for (const b of rows) {
    const email = b.email_address?.trim().toLowerCase();
    if (!email || !b.id) continue;
    // One person can hold more than one beneficiary record.
    const set = map.get(email) ?? new Set<string>();
    set.add(b.id);
    map.set(email, set);
  }
  return map;
}

/**
 * Why a partner did or didn't match a PayProp beneficiary. Matching is fuzzy at
 * the edges — the same person appears as "Chris Wilson-Slight" and "Chris
 * Wilson Slight" — so when it misses, the near-misses are worth more than a
 * bare false.
 */
export async function describeAgentMatch(
  email: string,
  displayName: string
): Promise<{
  email: string;
  displayName: string;
  directorySize: number;
  emailHit: boolean;
  nameHit: boolean;
  /** Beneficiary names sharing a word with theirs — the likely spellings. */
  candidates: string[];
}> {
  const { byEmail, byName } = await beneficiaryIndex();
  const wanted = normaliseAgentName(displayName);
  const words = new Set(wanted.split(" ").filter((w) => w.length > 2));
  const candidates: string[] = [];
  for (const name of byName.keys()) {
    if (name.split(" ").some((w) => words.has(w))) candidates.push(name);
  }
  return {
    email: email.toLowerCase(),
    displayName: wanted,
    directorySize: byEmail.size + byName.size,
    emailHit: (byEmail.get(email.trim().toLowerCase())?.size ?? 0) > 0,
    nameHit: (byName.get(wanted)?.size ?? 0) > 0,
    candidates: candidates.slice(0, 8),
  };
}

export function getAgentEarnings(
  email: string,
  month: string,
  displayName = ""
): AgentEarnings | null {
  const key = `agent:${email.toLowerCase()}:${month}`;
  return cachedAsync(key, () => computeAgentEarnings(email, month, displayName));
}

async function computeAgentEarnings(
  email: string,
  month: string,
  displayName: string
): Promise<AgentEarnings | null> {
  const accounts = payPropAccounts();
  if (accounts.length === 0) return null;

  const { byEmail, byName } = await beneficiaryIndex();
  // An empty directory means the fetch failed, not that nobody matched.
  // Returning a "no match" here would cache £0 as though it were the answer,
  // and the card would sit on zero for the whole TTL. Null means "unknown",
  // so the caller falls back and we try again.
  if (byEmail.size === 0) return null;

  let ids = byEmail.get(email.trim().toLowerCase());
  let matchedBy: "email" | "name" = "email";
  if (!ids?.size && displayName) {
    ids = byName.get(normaliseAgentName(displayName));
    if (ids?.size) matchedBy = "name";
  }
  if (!ids?.size) {
    return {
      month,
      earned: 0,
      passedThrough: 0,
      byCategory: [],
      paymentCount: 0,
      matched: false,
    };
  }

  // The same month's payments the admin figures use — already in hand, or
  // being fetched right now by whoever asked first.
  const { from, to } = monthRange(month);
  const rows = (await paymentsForRange(from, to)).flatMap(
    (p) => p.rows as Array<PaymentRow & { beneficiary?: { id?: string } }>
  );

  if (rows.length === 0) return null; // couldn't reach PayProp — not "earned nothing"

  let earned = 0;
  let passedThrough = 0;
  let paymentCount = 0;
  const cats = new Map<string, number>();

  for (const r of rows) {
    const bid = r.beneficiary?.id;
    if (!bid || !ids.has(bid)) continue;
    const amount = money(r.amount);
    const category = r.category?.name ?? "Other";
    paymentCount++;
    if (FEE_CATEGORIES.has(category)) {
      earned += amount;
      cats.set(category, (cats.get(category) ?? 0) + amount);
    } else {
      passedThrough += amount;
    }
  }

  return {
    month,
    earned,
    passedThrough,
    byCategory: [...cats.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    paymentCount,
    matched: true,
    matchedBy,
  };
}

/* --------------------------------- move-ins ------------------------------- */

interface InvoiceRow {
  invoice_type?: string;
  from_date?: string;
  gross_amount?: number;
  property_id?: string;
  property?: { id?: string; property_name?: string; address?: { first_line?: string; city?: string } };
  tenant?: { display_name?: string };
}

export interface MoveIns {
  month: string;
  /** Tenancies whose rent schedule starts this month. */
  count: number;
  /** Their combined monthly rent — the rent roll being added. */
  rentAdded: number;
  properties: Array<{
    /** PayProp's id — the only reliable join key across reports. */
    propertyId: string;
    /** Address-derived fallback key — move-in rows often carry no id. */
    propertyKey: string;
    property: string;
    tenant: string;
    rent: number;
    from: string;
  }>;
}

/**
 * Move-ins for a month, business-wide. A tenancy going live in PayProp means
 * a rent schedule starting, so that's what's counted — not a fee, which can
 * be raised before or after the tenant is in.
 *
 * Business-wide only: PayProp holds no agent against a property, so this
 * can't be split by partner. The agent dashboard keeps its REX figure.
 */
export function getMoveIns(month: string): MoveIns | null {
  return cachedAsync(`movein:${month}`, () => computeMoveIns(month));
}

async function computeMoveIns(month: string): Promise<MoveIns | null> {
  const accounts = payPropAccounts();
  if (accounts.length === 0) return null;

  const rows = (
    await Promise.all(
      accounts.map((a) =>
        payPropGetAll<InvoiceRow>(a, "export/invoices")
      )
    )
  ).flat();
  if (rows.length === 0) return null;

  const starting = rows.filter(
    (r) => r.invoice_type === "Rent" && (r.from_date ?? "").slice(0, 7) === month
  );

  return {
    month,
    count: starting.length,
    rentAdded: starting.reduce((t, r) => t + (Number(r.gross_amount) || 0), 0),
    properties: starting.map((r) => ({
      // PayProp's id, so callers can join without relying on the name — the
      // fallback below produces "11 Albion Street, Motherwell" where the
      // properties export says "Albion Street, 11", and the two never match.
      propertyId: r.property?.id ?? r.property_id ?? "",
      propertyKey: propertyKey(
        r.property?.property_name || r.property?.address?.first_line || ""
      ),
      property:
        r.property?.property_name ??
        [r.property?.address?.first_line, r.property?.address?.city]
          .filter(Boolean)
          .join(", ") ??
        "—",
      tenant: r.tenant?.display_name ?? "—",
      rent: Number(r.gross_amount) || 0,
      from: r.from_date ?? "",
    })),
  };
}
