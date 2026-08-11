import "server-only";
import { hasDb, q } from "@/lib/db";
import { getAgencyIncome, type AgencyIncome, type AgentSlice } from "@/lib/payprop-income";
import { currentMonth } from "@/lib/format";
import type { PayPropAccountId } from "@/lib/payprop";

/**
 * Commission per month, computed once and kept.
 *
 * WHY THIS EXISTS. PayProp clamps every page to 25 rows however many you ask
 * for, so one month across both agencies is ~1,400 rows / ~56 sequential
 * requests, and a year-to-date range is ~9,000 rows. Walking year-to-date on a
 * page load was never going to work — it is what left the YTD GCI tile empty —
 * and it got six times heavier the moment E&W started answering again.
 *
 * A closed month's commission cannot change. So it is walked once, stored, and
 * summed thereafter: the year-to-date figure becomes arithmetic over stored
 * months plus one live month, rather than a walk of the whole year. That also
 * gives the monthly GCI chart its series, and gives GCI-per-move-in a
 * denominator it can actually reach.
 *
 * Same shape and same rules as lib/business-history.ts, deliberately.
 */

export interface MonthlyGci {
  month: string;
  /** Every fee charged, whoever received it — the business's gross commission. */
  combinedGciGross: number;
  /** The same figure NET of VAT. This is what the accounts sheet reports and
   *  what every screen should show; PayProp's amounts are VAT-inclusive. */
  combinedGciNet: number;
  /** Commission the agency itself kept, net of VAT. */
  agencyIncomeNet: number;
  /** VAT taken off the combined figure — kept so a number can be traced. */
  vat: number;
  paymentCount: number;
  /** Partners who earned a fee — the honest denominator for "per agent". */
  agentsEarning: number;
  byAccount: Array<{ account: PayPropAccountId; label: string; combinedGci: number }>;
  /**
   * Per agent for THIS month, attributed by property. Stored alongside the
   * total deliberately: a drill-down computed from the same rows as the
   * headline cannot drift from it, whereas a separate per-agent query
   * eventually will. This is the reconciliation check — the parts sum to the
   * whole because they ARE the whole, split.
   */
  byAgent: AgentSlice[];
  /* ---------------------- rent collection, per month ----------------------
   * Deliberately NOT an arrears figure. Rebuilding arrears from invoices minus
   * payments was measured against PayProp's own balances and failed in both
   * directions — 67% precision and 22% recall on a closed month, far worse
   * mid-month — so it was rejected rather than shipped. These three are pure
   * FLOWS out of the payment rows: nothing is inferred, nothing can name the
   * wrong tenant, and month against month is a real trend.
   */
  /** Rent passed through to landlords this month. */
  rentCollected: number;
  /** DISTINCT properties that took any payment. */
  propertiesPaying: number;
  /** DISTINCT tenants who paid. */
  tenantsPaying: number;
  /** Agencies PayProp wouldn't let us read. Non-empty = this month is SHORT. */
  unreachable: PayPropAccountId[];
  computedAt: string;
  definitionVersion: number;
}

/**
 * Bump when the MEANING of a stored month changes, so frozen rows recompute.
 *
 * 1 — 11 Aug 2026. First version. Note that any month stored before E&W was
 *     re-authorised would hold Scotland only, which is not a stale figure but
 *     a figure missing the larger half of the business. Nothing is stored from
 *     before that point, but if it ever is, bump this rather than trusting it.
 */
/*
 * 2 — 11 Aug 2026. Adds the per-agent split (byAgent), attributed by PROPERTY
 *     rather than by beneficiary. Beneficiary attribution reported £0 for every
 *     Scotland agent regardless of performance, because Scotland's fees go
 *     straight to the agency and there is no beneficiary payment to match.
 */
/*
 * 3 — 11 Aug 2026. Adds rent collection per month (rentCollected,
 *     propertiesPaying, tenantsPaying) — the honest month-scoped answer for
 *     the Arrears tab, after the arrears REBUILD was tested and rejected.
 */
const DEFINITION_VERSION = 3;

/**
 * How far back the MONEY reaches — deliberately NOT HISTORY_FLOOR.
 *
 * That floor exists because Rex's viewing appointment types didn't exist before
 * Aug 2025, which has nothing to do with PayProp. PayProp's payment history
 * runs back to at least January 2022, so the commission chart is free to go
 * back further than the funnel can.
 */
export const MONEY_FLOOR = "2022-01";

/** Patience per month when explicitly backfilling. One cold month is ~1,400
 *  rows at PayProp's 25-row page cap, i.e. ~56 sequential requests. */
const PER_MONTH_WAIT_MS = 180_000;

/* ------------------------------- storage -------------------------------- */

async function loadStored(): Promise<Record<string, MonthlyGci>> {
  if (!hasDb()) return {};
  const rows = await q<{ month: string; data: string }>(
    "SELECT month, data FROM gci_months"
  ).catch(() => []);
  const out: Record<string, MonthlyGci> = {};
  for (const r of rows) {
    try {
      out[r.month] = JSON.parse(r.data) as MonthlyGci;
    } catch {
      /* skip corrupt row */
    }
  }
  return out;
}

async function store(entry: MonthlyGci): Promise<void> {
  if (!hasDb()) return;
  await q(
    `INSERT INTO gci_months (month, data) VALUES ($1, $2)
     ON CONFLICT (month) DO UPDATE SET data = $2, computed_at = NOW()`,
    [entry.month, JSON.stringify(entry)]
  ).catch(() => undefined);
}

/* ------------------------------ computation ------------------------------ */

function toMonthly(month: string, income: AgencyIncome): MonthlyGci {
  const net = (income as unknown as { net?: { combinedGci: number; agencyIncome: number; vat: number } }).net;
  return {
    month,
    combinedGciGross: income.combinedGci,
    // Prefer the pre-computed net block; fall back to the gross figure only if
    // it is absent, and say so by leaving vat at 0 rather than inventing one.
    combinedGciNet: net?.combinedGci ?? income.combinedGci,
    agencyIncomeNet: net?.agencyIncome ?? income.agencyIncome,
    vat: net?.vat ?? 0,
    paymentCount: income.paymentCount,
    agentsEarning: income.agentsEarning,
    byAccount: income.byAccount.map((a) => ({
      account: a.account,
      label: a.label,
      combinedGci: a.combinedGci,
    })),
    byAgent: income.byAgentProperty ?? [],
    rentCollected: income.ownerPayments ?? 0,
    propertiesPaying: income.propertiesPaying ?? 0,
    tenantsPaying: income.tenantsPaying ?? 0,
    unreachable: income.unreachable ?? [],
    computedAt: new Date().toISOString(),
    definitionVersion: DEFINITION_VERSION,
  };
}

/**
 * Storable = complete. A month with an unreachable agency is NOT frozen: it is
 * short by a whole agency, and freezing it would make a temporary credential
 * failure permanent — which is exactly how the £0 E&W figures would have
 * become the historical record.
 */
function complete(m: MonthlyGci): boolean {
  return (
    m.definitionVersion >= DEFINITION_VERSION &&
    m.unreachable.length === 0 &&
    m.paymentCount > 0
  );
}

/** Months from `from` (floored) up to and including `to`. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 1));
  while (cursor.toISOString().slice(0, 7) <= to) {
    out.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

/**
 * Commission for every month from `fromMonth` up to and including `toMonth`.
 *
 * Stored months return instantly. Missing ones are computed — SEQUENTIALLY,
 * unlike the funnel backfill: every PayProp request already funnels through one
 * global queue, so fanning out buys nothing and only makes the rate limiter
 * more likely to bite mid-walk. The live (unfinished) month is always
 * recomputed and never stored.
 *
 * Never throws. A month that can't be computed is simply absent from the
 * result, and callers must treat absence as "not known", never as zero.
 */
export async function getGciHistory(
  fromMonth = MONEY_FLOOR,
  toMonth = currentMonth(),
  opts: { wait?: boolean } = {}
): Promise<Record<string, MonthlyGci>> {
  const from = fromMonth;
  const live = currentMonth();
  const months = monthsBetween(from, toMonth);
  const stored = await loadStored().catch(() => ({}) as Record<string, MonthlyGci>);
  const out: Record<string, MonthlyGci> = {};

  for (const m of months) {
    const isLive = m >= live;
    if (!isLive && stored[m] && complete(stored[m])) {
      out[m] = stored[m];
      continue;
    }
    /*
     * getAgencyIncome is NON-BLOCKING on a cold key: it returns null at once
     * and computes in the background. That is right for a page load and wrong
     * for a backfill — asking for eight cold months returns eight nulls, so
     * nothing is stored and every tile stays blank until the walks happen to
     * finish and somebody reloads. That is exactly what happened.
     *
     * On a page load we still fire-and-forget (the call above starts the work,
     * and the next load picks it up). With `wait`, we poll until it lands, so
     * an explicit backfill actually backfills.
     */
    let income = await getAgencyIncome(m).catch(() => null);
    if (!income && opts.wait) {
      const deadline = Date.now() + PER_MONTH_WAIT_MS;
      while (!income && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        income = await getAgencyIncome(m).catch(() => null);
      }
    }
    if (!income) {
      if (stored[m]) out[m] = stored[m];
      continue;
    }
    const entry = toMonthly(m, income);
    out[m] = entry;
    if (!isLive && complete(entry)) await store(entry).catch(() => undefined);
  }
  return out;
}

export interface GciSeries {
  /** Oldest first — what the chart plots. */
  months: MonthlyGci[];
  /** Net-of-VAT commission across the whole window. */
  ytdNet: number | null;
  ytdGross: number | null;
  /** True when every month in the window answered. A partial sum is a smaller
   *  but entirely plausible number, so callers must be able to tell. */
  complete: boolean;
  /** Months asked for that had no answer. */
  missing: string[];
  /** Any agency missing from any month in the window. */
  unreachable: PayPropAccountId[];
}

/**
 * The year-to-date money for `month`, as a sum of stored months.
 *
 * This is the whole point of the store: year-to-date used to mean one ~9,000
 * row walk that PayProp rejected outright (its report caps at 94 days), and now
 * means adding up numbers we already hold.
 */
export async function getGciSeries(month = currentMonth()): Promise<GciSeries> {
  const year = month.slice(0, 4);
  // January of the selected year. Not clamped to HISTORY_FLOOR: that floor is
  // about Rex viewings, and money has its own, much longer reach.
  const start = `${year}-01`;
  const hist = await getGciHistory(start, month);
  const asked = monthsBetween(start, month);
  const months = asked.map((m) => hist[m]).filter(Boolean);
  const missing = asked.filter((m) => !hist[m]);
  const unreachable = [...new Set(months.flatMap((m) => m.unreachable))];
  const isComplete = missing.length === 0 && unreachable.length === 0;
  return {
    months,
    // Only report a total when the window is whole. A year-to-date figure
    // short by one month reads exactly like a quiet year.
    ytdNet: isComplete ? Math.round(months.reduce((t, m) => t + m.combinedGciNet, 0) * 100) / 100 : null,
    ytdGross: isComplete ? Math.round(months.reduce((t, m) => t + m.combinedGciGross, 0) * 100) / 100 : null,
    complete: isComplete,
    missing,
    unreachable,
  };
}
