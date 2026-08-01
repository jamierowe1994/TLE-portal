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

/** What report/all-payments puts on the wire (the fields we care about). */
export interface PaymentRow {
  id?: string;
  amount?: string;
  category?: { id?: string; name?: string };
  beneficiary?: { id?: string; name?: string; type?: string };
  due_date?: string;
  description?: string;
}

/**
 * A payment reduced to what anything actually reads.
 *
 * PayProp's rows carry roughly 850 bytes each of envelope nobody here looks at
 * — tenant, property, batch, reconciliation date, references. That's harmless
 * in memory and not harmless at all in jsonb: a year-to-date range is ~9,000
 * rows, so 7.7 MB to write and then JSON.parse on the request path of every
 * cold process. Reduced, the same range is about 1 MB.
 *
 * Single-letter keys because at this row count the field names would be most
 * of the bytes. `d` is read by nothing today; it's stored anyway because
 * serving a month by slicing the year-to-date rows locally is the next win
 * here, and a field dropped from a cached shape can only be got back by
 * re-walking every live range.
 */
interface Payment {
  /** amount, already parsed — PayProp sends money as a string. */
  a: number;
  /** category name; "" reads as "Other", same as a missing category did. */
  c: string;
  /** beneficiary id */
  b: string;
  /** beneficiary type — "agency", "beneficiary", "global_beneficiary" */
  t: string;
  /** beneficiary name, trimmed */
  n: string;
  /** due date */
  d: string;
}

function reduceRows(rows: PaymentRow[]): Payment[] {
  // PayProp's all-payments report interleaves BLANK rows: no id, 0.00 amount,
  // null category, beneficiary and due_date. Measured against live data on
  // 1 Aug 2026 — 1 in 25 on Scotland, 3 in 25 on the rest of the UK.
  //
  // They carry no money, so they never moved a total. What they did do is
  // inflate paymentCount (and byPartner[].payments), and get persisted to
  // Postgres along with everything else. A payment count is a figure people
  // read, so an overstatement of 4-12% is not cosmetic.
  return rows
    .filter((r) => String(r.id ?? "").trim() !== "")
    .map((r) => ({
      a: money(r.amount),
      c: r.category?.name ?? "",
      b: r.beneficiary?.id ?? "",
      t: r.beneficiary?.type ?? "",
      n: r.beneficiary?.name?.trim() ?? "",
      d: r.due_date ?? "",
    }));
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
const CACHE_VERSION = "v5"; // v5: blank PayProp rows no longer counted

async function cachedAsync<T>(rawKey: string, run: () => Promise<T>): Promise<T | null> {
  const key = `${CACHE_VERSION}:${rawKey}`;
  return cachedAsyncInner(key, run);
}

// A run that returns null means "we couldn't find out", not "the answer is
// nothing" — but the null was being cached with a fresh timestamp and written
// to Postgres, where JSON null becomes a jsonb null and passes the NOT NULL
// column, so it survived deploys too. The dashboard then polled a dead key
// every five seconds for 200 seconds and was served the same null every time.
// Remember the FAILURE instead, briefly: long enough that the poll can't turn
// one bad walk into forty, short enough to recover on its own.
const FAILURE_COOLDOWN_MS = 45_000;
const failedAt = new Map<string, number>();

async function cachedAsyncInner<T>(key: string, run: () => Promise<T>): Promise<T | null> {
  let hit = cache.get(key);

  // On a cold process the database usually already holds the answer from before
  // the last deploy. Read it HERE, on the request path — it costs a few
  // milliseconds, against a walk that costs a minute or more. This used to sit
  // inside the background job below, which meant the very request that needed
  // the durable cache was the one request guaranteed not to see it.
  if (!hit) {
    const stored = await readCache<T>(key).catch(() => null);
    // `stored.data == null` is a failure result written by an older build —
    // rows like that are already in the table. Treat one as a miss rather than
    // an answer, or it goes on being served for the whole TTL and the refresh
    // below never even starts.
    if (stored && stored.data != null) {
      hit = { at: stored.at, data: stored.data };
      cache.set(key, hit);
    }
  }

  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T;

  const cooling = Date.now() - (failedAt.get(key) ?? 0) < FAILURE_COOLDOWN_MS;
  if (!running.has(key) && !cooling) {
    running.add(key);
    void (async () => {
      const data = await run();
      if (data == null) {
        failedAt.set(key, Date.now());
        return;
      }
      failedAt.delete(key);
      cache.set(key, { at: Date.now(), data });
      await writeCache(key, data);
    })()
      .catch(() => {
        failedAt.set(key, Date.now());
      })
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
type AccountRows = Array<{ account: PayPropAccountId; rows: Payment[] }>;
const rangeCache = new Map<string, { at: number; data: AccountRows }>();
const rangeInflight = new Map<string, Promise<AccountRows>>();
/** Ranges we've already asked Postgres about, hit or miss — one round-trip per
 *  range per process, rather than one per call. */
const rangeRead = new Set<string>();

/** Bump with the Payment shape. A stored range the readers no longer
 *  understand isn't an error, it's a wrong money figure — see the cached-shape
 *  rule; forgetting this has cost this project four misdiagnoses. */
const RANGE_CACHE_VERSION = "v2"; // v2: blank rows filtered out
const rangeKey = (range: string) => `payprop:payments:${RANGE_CACHE_VERSION}:${range}`;

/** Past this, in-memory is enough: a multi-megabyte jsonb round-trip on every
 *  cold start costs more than it saves. ~30k reduced rows is ~3.5 MB, well
 *  beyond the ~9k a year-to-date range actually needs — and that ~9k is both
 *  agencies' rows together, each walked separately under payprop.ts's 5,000-row
 *  per-account ceiling, so it is not evidence that the range fits under one. */
const MAX_PERSISTED_ROWS = 30_000;

/** Cheap structural check — a stored blob from a shape we no longer read must
 *  fall back to the walk rather than quietly total up to nothing. */
function isAccountRows(v: unknown): v is AccountRows {
  if (!Array.isArray(v)) return false;
  return v.every((p) => {
    if (!p || typeof p !== "object") return false;
    const { account, rows } = p as { account?: unknown; rows?: unknown };
    if (typeof account !== "string" || !Array.isArray(rows)) return false;
    return rows.length === 0 || typeof (rows[0] as Payment | undefined)?.a === "number";
  });
}

async function paymentsForRange(from: string, to: string): Promise<AccountRows> {
  const key = `${from}|${to}`;
  const fresh = () => {
    const hit = rangeCache.get(key);
    return hit && Date.now() - hit.at < RANGE_TTL_MS ? hit.data : null;
  };

  const hot = fresh();
  if (hot) return hot;

  const inflight = rangeInflight.get(key);
  if (inflight) return inflight;

  // Cold process: this range is usually still in Postgres from before the last
  // deploy, and reading it costs milliseconds against a walk that costs a
  // minute. Reduced rows (see Payment) are what make that affordable.
  if (!rangeRead.has(key)) {
    rangeRead.add(key);
    const stored = await readCache<unknown>(rangeKey(key)).catch(() => null);
    if (stored && isAccountRows(stored.data)) {
      rangeCache.set(key, { at: stored.at, data: stored.data });
    }
    // Someone may have started the walk while that read was in flight.
    const raced = fresh() ?? rangeInflight.get(key);
    if (raced) return raced;
  }

  const job = (async () => {
    const accounts = payPropAccounts();
    // Both agencies at once. Every request already funnels through the single
    // global queue in payprop.ts, so this cannot raise the requests per second
    // — it only stops the second agency waiting out the first. (The comment
    // that used to sit here claimed running them together doubled the rate,
    // which stopped being true when the queue became global.)
    const settled = await Promise.allSettled(
      accounts.map(async (a) => ({
        account: a,
        rows: reduceRows(
          await payPropGetAll<PaymentRow>(a, "report/all-payments", {
            from_date: from,
            to_date: to,
          })
        ),
      }))
    );
    // allSettled, not all: bailing on the first rejection would leave the other
    // agency's walk running orphaned in the shared queue, and the caller's
    // retry would then start a second copy of it alongside.
    const failed = settled.find((s) => s.status === "rejected");
    if (failed) throw failed.reason;
    return settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  })();

  rangeInflight.set(key, job);
  try {
    const data = await job;
    rangeCache.set(key, { at: Date.now(), data });
    const rows = data.reduce((n, p) => n + p.rows.length, 0);
    if (rows > 0 && rows <= MAX_PERSISTED_ROWS) {
      await writeCache(rangeKey(key), data);
    }
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
export function getAgencyIncome(month: string): Promise<AgencyIncome | null> {
  const { from, to } = monthRange(month);
  return cachedAsync(`income:${month}`, () => computeIncomeRange(month, from, to));
}

/**
 * Everything earned from 1 January up to the end of `month` — the year-to-date
 * figures on the admin home. One range query, not one per month.
 */
export function getYtdIncome(month: string): Promise<AgencyIncome | null> {
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
  const sliceOf = (list: Payment[]) => {
    let agency = 0;
    let partners = 0;
    for (const r of list) {
      const cat = r.c || "Other";
      if (!FEE_CATEGORIES.has(cat)) continue;
      if (r.t === "agency") agency += r.a;
      else if (r.t === "beneficiary" || r.t === "global_beneficiary") partners += r.a;
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
    const amount = r.a;
    const type = r.t;
    const category = r.c || "Other";

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
      if (r.b) earners.add(r.b);
      const who = r.n;
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
export function getArrears(): Promise<ArrearsSummary | null> {
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

/** Bump with the encoded shape below. */
const BENEFICIARY_KEY = "payprop:beneficiaries:v1";

/**
 * Maps and Sets do not survive JSON, and they fail SILENTLY: round-tripping
 * this index gives `{"byEmail":{},"byName":{}}` with no error anywhere. The
 * empty-directory guard in computeAgentEarnings tests `.size === 0`, which is
 * false against `undefined`, so execution would carry on to `byEmail.get(...)`
 * and throw "is not a function" on every partner's earnings card. Hence the
 * explicit entry-array encoding, and the `instanceof Map` check on the guard.
 *
 * Small enough to be worth persisting whole: ~100 bytes per person across both
 * indexes, so ~29 KB for 300 beneficiaries. Both indexes are kept — the
 * near-miss suggestions in describeAgentMatch iterate byName.
 */
interface StoredIndex {
  byEmail: Array<[string, string[]]>;
  byName: Array<[string, string[]]>;
}

const encodeMap = (m: Map<string, Set<string>>): Array<[string, string[]]> =>
  [...m].map(([k, v]) => [k, [...v]]);

function decodeIndex(raw: unknown): BeneficiaryIndex | null {
  const s = raw as Partial<StoredIndex> | null;
  if (!s || !Array.isArray(s.byEmail) || !Array.isArray(s.byName)) return null;
  const decode = (pairs: Array<[string, string[]]>) => {
    const m = new Map<string, Set<string>>();
    for (const p of pairs) {
      if (!Array.isArray(p) || typeof p[0] !== "string" || !Array.isArray(p[1])) continue;
      m.set(p[0], new Set(p[1].filter((x): x is string => typeof x === "string")));
    }
    return m;
  };
  const byEmail = decode(s.byEmail);
  const byName = decode(s.byName);
  // An empty stored index is indistinguishable from a failed walk that got
  // written by mistake — treat it as a miss and go and fetch.
  if (byEmail.size === 0 && byName.size === 0) return null;
  return { byEmail, byName };
}

/** Whether Postgres has already been consulted this process. */
let beneficiaryRead = false;
/** A rejecting walk used to relaunch on the very next request, putting twelve
 *  pages straight back into the shared PayProp queue. The other two cache paths
 *  (cachedAsyncInner, getPortfolioBook) both wait before retrying; so does this
 *  one now. */
let beneficiaryFailedAt = 0;

/** An index we know nothing from — the shape callers already read as "the walk
 *  failed", never as "nobody matched". Built fresh so no caller can mutate a
 *  shared one. */
const unknownIndex = (): BeneficiaryIndex => ({ byEmail: new Map(), byName: new Map() });

/**
 * @param waitForRefresh - block on the walk rather than serve a stale index.
 *   Set by the money path only; see the note at the bottom of this function.
 */
async function beneficiaryIndex(waitForRefresh = false): Promise<BeneficiaryIndex> {
  // Every partner loading their dashboard was walking the whole directory.
  // It changes when someone joins, not by the minute.
  if (beneficiaryCache && Date.now() - beneficiaryCache.at < RANGE_TTL_MS) {
    return beneficiaryCache.data;
  }

  // Cold process: the directory is in Postgres from before the deploy, and a
  // few milliseconds of read beats twelve pages of walk on a request path.
  if (!beneficiaryCache && !beneficiaryRead) {
    beneficiaryRead = true;
    const stored = await readCache<unknown>(BENEFICIARY_KEY).catch(() => null);
    if (stored) {
      const decoded = decodeIndex(stored.data);
      if (decoded) beneficiaryCache = { at: stored.at, data: decoded };
    }
    if (beneficiaryCache && Date.now() - beneficiaryCache.at < RANGE_TTL_MS) {
      return beneficiaryCache.data;
    }
  }

  const cooling = Date.now() - beneficiaryFailedAt < FAILURE_COOLDOWN_MS;
  const job = beneficiaryInflight ?? (cooling ? null : startBeneficiaryWalk());

  // WHY THE MONEY PATH WAITS AND THE DIAGNOSTIC ONE DOESN'T. Serving a stale
  // index to computeAgentEarnings under-counts SILENTLY: a partner who has
  // gained a second PayProp beneficiary record — precisely the case this index
  // exists to handle — resolves to their old id alone, so the fees paid to the
  // new record are skipped and the result still comes back matched:true, which
  // the dashboard badges as live. That figure is then cached for an hour and
  // written to Postgres, so the refresh landing seconds later never corrects
  // it. An unmatched partner degrades honestly; a PARTIALLY matched one must
  // not render as complete. Waiting costs nothing on the request path either:
  // cachedAsync only ever calls computeAgentEarnings from its background job.
  // describeAgentMatch is a ?debug=1 read on the request path with no money in
  // it, so it keeps the stale answer and the speed.
  if (waitForRefresh) return job ?? unknownIndex();
  if (beneficiaryCache) {
    if (job) void job.catch(() => {});
    return beneficiaryCache.data;
  }
  return job ?? unknownIndex();
}

function startBeneficiaryWalk(): Promise<BeneficiaryIndex> {
  const job = buildBeneficiaryIndex()
    .then(async (data) => {
      // Never cache an empty index — that's a failed walk, and caching it
      // would report every partner as unmatched for the whole hour.
      if (data.byEmail.size || data.byName.size) {
        beneficiaryCache = { at: Date.now(), data };
        beneficiaryFailedAt = 0;
        await writeCache(BENEFICIARY_KEY, {
          byEmail: encodeMap(data.byEmail),
          byName: encodeMap(data.byName),
        } satisfies StoredIndex);
      } else {
        // Nothing was cached, so without the cooldown the next request starts
        // another twelve-page walk immediately — same spin as a rejection.
        beneficiaryFailedAt = Date.now();
      }
      return data;
    })
    .catch((e: unknown) => {
      beneficiaryFailedAt = Date.now();
      throw e;
    })
    .finally(() => {
      beneficiaryInflight = null;
    });
  beneficiaryInflight = job;
  return job;
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
): Promise<AgentEarnings | null> {
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

  // `true`: never resolve a partner's ids against a directory past its TTL —
  // an out-of-date one under-counts and still says matched. See beneficiaryIndex.
  const { byEmail, byName } = await beneficiaryIndex(true);
  // An empty directory means the fetch failed, not that nobody matched.
  // Returning a "no match" here would cache £0 as though it were the answer,
  // and the card would sit on zero for the whole TTL. Null means "unknown",
  // so the caller falls back and we try again.
  //
  // `instanceof Map` as well as size: a stored index that lost its Maps to a
  // JSON round-trip has `size === undefined`, which slips straight past a
  // `=== 0` test and then throws on the `.get` below.
  if (!(byEmail instanceof Map) || byEmail.size === 0) return null;

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
  const rows = (await paymentsForRange(from, to)).flatMap((p) => p.rows);

  if (rows.length === 0) return null; // couldn't reach PayProp — not "earned nothing"

  let earned = 0;
  let passedThrough = 0;
  let paymentCount = 0;
  const cats = new Map<string, number>();

  for (const r of rows) {
    if (!r.b || !ids.has(r.b)) continue;
    const category = r.c || "Other";
    paymentCount++;
    if (FEE_CATEGORIES.has(category)) {
      earned += r.a;
      cats.set(category, (cats.get(category) ?? 0) + r.a);
    } else {
      passedThrough += r.a;
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
export function getMoveIns(month: string): Promise<MoveIns | null> {
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
