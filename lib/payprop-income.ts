import "server-only";
import { payPropAccounts, payPropGetAll, type PayPropAccountId } from "@/lib/payprop";

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
  /** Commission the agency itself took — the GCI figure. */
  agencyIncome: number;
  /** Fees paid out to associates/partners rather than kept by the agency. */
  paidToBeneficiaries: number;
  /** Rent passed through to landlords — not income, but the volume behind it. */
  ownerPayments: number;
  /** Agency income split by fee type, biggest first. */
  byCategory: Array<{ category: string; amount: number }>;
  paymentCount: number;
  accounts: PayPropAccountId[];
}

// Walking a month of payments is ~40 sequential requests, so hold the result
// briefly — the admin centre re-renders far more often than the money moves.
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

const running = new Set<string>();

/**
 * Serve what we have and refresh behind the scenes. A month of payments is
 * ~40 sequential requests (PayProp rate-limits, so they can't be parallel),
 * which is far too slow to block an admin page on. The first call returns
 * null and starts the walk; once it lands every later call is instant.
 */
function cachedAsync<T>(key: string, run: () => Promise<T>): T | null {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T;

  if (!running.has(key)) {
    running.add(key);
    void run()
      .then((data) => cache.set(key, { at: Date.now(), data }))
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

const money = (v: unknown) => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

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
  return cachedAsync(`income:${month}`, () => computeAgencyIncome(month));
}

async function computeAgencyIncome(month: string): Promise<AgencyIncome | null> {
  const accounts = payPropAccounts();
  if (accounts.length === 0) return null;

  const { from, to } = monthRange(month);
  const perAccount = await Promise.all(
    accounts.map((a) =>
      payPropGetAll<PaymentRow>(a, "report/all-payments", {
        from_date: from,
        to_date: to,
      }).catch(() => [] as PaymentRow[])
    )
  );
  const rows = perAccount.flat();
  if (rows.length === 0) return null;

  let agencyIncome = 0;
  let paidToBeneficiaries = 0;
  let ownerPayments = 0;
  const cats = new Map<string, number>();

  for (const r of rows) {
    const amount = money(r.amount);
    const type = r.beneficiary?.type;
    const category = r.category?.name ?? "Other";

    if (type === "agency") {
      agencyIncome += amount;
      cats.set(category, (cats.get(category) ?? 0) + amount);
    } else if (category === "Owner") {
      ownerPayments += amount;
    } else if (type === "beneficiary" || type === "global_beneficiary") {
      // Fees that went to someone other than the agency — the associate split.
      if (category !== "Contractor" && category !== "Deposit (Custodial)") {
        paidToBeneficiaries += amount;
      }
    }
  }

  return {
    month,
    agencyIncome,
    paidToBeneficiaries,
    ownerPayments,
    byCategory: [...cats.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    paymentCount: rows.length,
    accounts,
  };
}

/* --------------------------------- arrears -------------------------------- */

export interface TenantBalanceRow {
  balance?: string;
  tenant?: { id?: string; name?: string; is_active?: boolean };
  property?: { id?: string; name?: string; is_active?: boolean };
  last_invoice?: { amount?: string; date?: string };
}

export interface ArrearsSummary {
  /** Tenants in debit, worst first. */
  tenants: Array<{
    tenant: string;
    property: string;
    owed: number;
    lastInvoice: string | null;
  }>;
  totalOwed: number;
  /** How many tenancies were checked, so a count can be shown honestly. */
  checked: number;
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
    accounts.map((a) =>
      payPropGetAll<TenantBalanceRow>(a, "report/tenant/balances").catch(
        () => [] as TenantBalanceRow[]
      )
    )
  );
  const rows = perAccount.flat();
  if (rows.length === 0) return null;

  const tenants = rows
    .map((r) => ({
      tenant: r.tenant?.name ?? "Unknown",
      property: r.property?.name ?? "—",
      owed: -money(r.balance), // negative balance = in arrears
      lastInvoice: r.last_invoice?.date ?? null,
    }))
    .filter((t) => t.owed > 0.005)
    .sort((a, b) => b.owed - a.owed);

  return {
    tenants,
    totalOwed: tenants.reduce((t, x) => t + x.owed, 0),
    checked: rows.length,
  };
}

/* ---------------------------- one agent's money --------------------------- */

// TLE's partners are beneficiaries in PayProp, carrying their
// @thelettingexperts.co.uk address — the same address they sign into the
// portal with, which makes email the join key. Their commission is simply the
// payments made to them, minus the categories that aren't earnings
// (contractor reimbursements and deposit movements pass through them).

const NOT_EARNINGS = new Set(["Contractor", "Deposit (Custodial)", "Property account"]);

export interface AgentEarnings {
  month: string;
  /** What they earned — fees only. */
  earned: number;
  /** Money that merely passed through them, kept separate so it can be shown. */
  passedThrough: number;
  byCategory: Array<{ category: string; amount: number }>;
  paymentCount: number;
  /** False when no PayProp beneficiary carries this address. */
  matched: boolean;
}

interface BeneficiaryRow {
  id?: string;
  first_name?: string;
  last_name?: string;
  business_name?: string;
  email_address?: string;
}

/** email (lowercased) → PayProp beneficiary id, for every connected account. */
async function beneficiaryIdsByEmail(): Promise<Map<string, Set<string>>> {
  const accounts = payPropAccounts();
  const rows = (
    await Promise.all(
      accounts.map((a) =>
        payPropGetAll<BeneficiaryRow>(a, "export/beneficiaries").catch(
          () => [] as BeneficiaryRow[]
        )
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

export function getAgentEarnings(email: string, month: string): AgentEarnings | null {
  const key = `agent:${email.toLowerCase()}:${month}`;
  return cachedAsync(key, () => computeAgentEarnings(email, month));
}

async function computeAgentEarnings(
  email: string,
  month: string
): Promise<AgentEarnings | null> {
  const accounts = payPropAccounts();
  if (accounts.length === 0) return null;

  const ids = (await beneficiaryIdsByEmail()).get(email.trim().toLowerCase());
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

  const { from, to } = monthRange(month);
  const rows = (
    await Promise.all(
      accounts.map((a) =>
        payPropGetAll<PaymentRow & { beneficiary?: { id?: string } }>(
          a,
          "report/all-payments",
          { from_date: from, to_date: to }
        ).catch(() => [])
      )
    )
  ).flat();

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
    if (NOT_EARNINGS.has(category)) {
      passedThrough += amount;
    } else {
      earned += amount;
      cats.set(category, (cats.get(category) ?? 0) + amount);
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
  };
}
