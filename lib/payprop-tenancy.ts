import "server-only";
import { payPropAccounts, payPropGetAll, type PayPropAccountId } from "@/lib/payprop";
import { propertyKey } from "@/lib/payprop-portfolio";
import { readCache, writeCache } from "@/lib/integration-cache";

// The tenancy register: two facts per managed property that the 2 Aug 2026
// probe proved PayProp holds and nothing else does.
//
//   · RLP (rent & legal protection — the business calls it PLC). Written into
//     recurring payment-instruction descriptions in BOTH states: "Protected
//     with RLP" and "Without RLP". Census: 97 protected / 126 without / 0
//     contradictory / 255 silent across 478 UK properties. Instructions carry
//     a real property id, so the join is exact.
//   · The tenancy itself. export/tenants nests, under each tenant's
//     properties[], the tenant block {start_date, end_date, deposit_id}.
//     deposit_id was populated on 100% of 662 UK tenancies.
//
// Three walks per agency (properties are NOT re-walked here — the RLP bucket
// "silent" is derived by the caller against the portfolio book it already
// has). ~90 pages total on the UK agency at 2.5 req/s ≈ 40s, so this follows
// the portfolio book's pattern exactly: durable cache read on cold start,
// serve stale, refresh behind, never block a page.

export interface PropertyTenancy {
  /** ISO date the current tenancy started. */
  startDate: string | null;
  /** Usually null — only 17.5% of tenancies carry an end date (periodic). */
  endDate: string | null;
  /** PayProp's deposit ledger reference, e.g. "TLE279". Present = a deposit
   *  is registered against this tenancy in PayProp. Says nothing about WHICH
   *  scheme holds it — no system records that (probe, 2 Aug 2026). */
  depositId: string | null;
  /** PayProp's tenant status for the row the tenancy came from. */
  tenantStatus: string | null;
}

export interface RlpEntry {
  status: "protected" | "without";
  /** The instruction text the classification came from, verbatim. */
  evidence: string;
  /** True when the ONLY evidence sits on a disabled instruction — trust it
   *  less; the census found two of these. */
  disabledOnly: boolean;
}

export interface TenancyRegister {
  /** Keyed by PayProp property id. */
  tenancyByPropertyId: Record<string, PropertyTenancy>;
  rlpByPropertyId: Record<string, RlpEntry>;
  /**
   * The same two lookups by ADDRESS KEY, for surfaces that hold an address
   * and no PayProp id (Kirstie's deals, REX compliance rows). Same discipline
   * as serviceLevelByKey: a key two properties disagree over is DROPPED, not
   * resolved — a wrong "deposit held" or "protected" is worse than a blank.
   */
  tenancyByKey: Record<string, PropertyTenancy>;
  rlpByKey: Record<string, RlpEntry>;
  counts: {
    tenancies: number;
    withDepositId: number;
    rlpProtected: number;
    rlpWithout: number;
    /** Properties whose instructions said BOTH things. Listed, never resolved. */
    rlpContradictory: string[];
  };
  computedAt: string;
}

const CACHE_KEY = "payprop:tenancy-register:v1";
const TTL_MS = 60 * 60_000;
const FAILURE_COOLDOWN_MS = 60_000;

let cache: { at: number; data: TenancyRegister } | null = null;
let running = false;
let failedAt = 0;
let lastError: string | null = null;

export function tenancyRegisterError(): string | null {
  return lastError;
}

const RLP_PROTECTED = /protected\s+with\s+rlp/i;
const RLP_WITHOUT = /without\s+rlp/i;

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

async function computeRegister(): Promise<TenancyRegister | null> {
  const accounts = payPropAccounts();
  if (accounts.length === 0) return null;

  const tenancyByPropertyId: Record<string, PropertyTenancy> = {};
  const nameByPropertyId: Record<string, string> = {};
  const rlpEvidence = new Map<
    string,
    { protected: string[]; without: string[]; enabledHit: boolean }
  >();
  let tenancies = 0;
  let withDepositId = 0;

  for (const account of accounts as PayPropAccountId[]) {
    // ---- tenancies ----
    const tenants = await payPropGetAll<Record<string, unknown>>(
      account,
      "export/tenants"
    );
    for (const t of tenants) {
      const status = str(t.status);
      const properties = Array.isArray(t.properties) ? t.properties : [];
      for (const pr of properties as Array<Record<string, unknown>>) {
        const pid = str(pr.id);
        if (!pid) continue;
        const nm = str(pr.property_name);
        if (nm && !nameByPropertyId[pid]) nameByPropertyId[pid] = nm;
        const tn = (pr.tenant ?? {}) as Record<string, unknown>;
        const startDate = str(tn.start_date);
        const endDate = str(tn.end_date);
        const depositId = str(tn.deposit_id);
        if (!startDate && !depositId) continue;
        tenancies++;
        if (depositId) withDepositId++;

        // A property can appear under several tenant rows (past + present).
        // Keep the CURRENT tenancy: an Active row beats an Inactive one, and
        // within the same status the later start date wins. "Latest start"
        // alone would let an old Inactive row shadow a live one.
        const existing = tenancyByPropertyId[pid];
        const candidate: PropertyTenancy = {
          startDate,
          endDate,
          depositId,
          tenantStatus: status,
        };
        if (!existing) {
          tenancyByPropertyId[pid] = candidate;
        } else {
          const exActive = existing.tenantStatus === "Active";
          const nowActive = status === "Active";
          if (
            (nowActive && !exActive) ||
            (nowActive === exActive &&
              (candidate.startDate ?? "") > (existing.startDate ?? ""))
          ) {
            tenancyByPropertyId[pid] = candidate;
          }
        }
      }
    }

    // ---- RLP, from payment-instruction free text ----
    const instructions = await payPropGetAll<Record<string, unknown>>(
      account,
      "export/payments"
    );
    for (const row of instructions) {
      const prop = row.property as Record<string, unknown> | undefined;
      const pid = str(prop?.id);
      if (!pid) continue;
      const nm = str(prop?.name);
      if (nm && !nameByPropertyId[pid]) nameByPropertyId[pid] = nm;
      const enabled = row.enabled !== false;
      for (const field of [row.description, row.beneficiary_reference]) {
        const text = str(field);
        if (!text) continue;
        const hitP = RLP_PROTECTED.test(text);
        const hitW = RLP_WITHOUT.test(text);
        if (!hitP && !hitW) continue;
        const e =
          rlpEvidence.get(pid) ?? { protected: [], without: [], enabledHit: false };
        if (enabled) e.enabledHit = true;
        const note = text.slice(0, 160) + (enabled ? "" : " [instruction disabled]");
        if (hitP && e.protected.length < 3) e.protected.push(note);
        if (hitW && e.without.length < 3) e.without.push(note);
        rlpEvidence.set(pid, e);
      }
    }
  }

  const rlpByPropertyId: Record<string, RlpEntry> = {};
  const contradictory: string[] = [];
  let protectedCount = 0;
  let withoutCount = 0;
  for (const [pid, e] of rlpEvidence) {
    if (e.protected.length && e.without.length) {
      // Both wordings on one property is a question for a human, not a coin
      // toss here. No entry — the property reads as "not recorded".
      contradictory.push(pid);
      continue;
    }
    const status = e.protected.length ? "protected" : "without";
    if (status === "protected") protectedCount++;
    else withoutCount++;
    rlpByPropertyId[pid] = {
      status,
      evidence: (e.protected[0] ?? e.without[0]) as string,
      disabledOnly: !e.enabledHit,
    };
  }

  if (tenancies === 0 && rlpEvidence.size === 0) return null;

  // Address-key projections, collision-dropped. Built from the id maps so the
  // two views can never disagree with each other.
  const keyOf = (pid: string) => {
    const nm = nameByPropertyId[pid];
    return nm ? propertyKey(nm) : "";
  };
  // Contested keys come from EVERY property PayProp named, not just the ones
  // with register entries. Two flats can share a key while only one has an
  // RLP instruction — projecting entries alone would resolve that key to the
  // one with data and attribute it to whichever property the caller holds
  // (review find). If the ADDRESS is ambiguous, the key is dead, full stop.
  const contested = new Set<string>();
  {
    const claims = new Map<string, Set<string>>();
    for (const pid of Object.keys(nameByPropertyId)) {
      const k = keyOf(pid);
      if (!k) continue;
      const set = claims.get(k) ?? new Set<string>();
      set.add(pid);
      claims.set(k, set);
    }
    for (const [k, pids] of claims) if (pids.size > 1) contested.add(k);
  }
  const project = <T,>(byId: Record<string, T>): Record<string, T> => {
    const seen = new Map<string, Array<{ pid: string; value: T }>>();
    for (const [pid, value] of Object.entries(byId)) {
      const k = keyOf(pid);
      if (!k || contested.has(k)) continue;
      const arr = seen.get(k) ?? [];
      arr.push({ pid, value });
      seen.set(k, arr);
    }
    const out: Record<string, T> = {};
    for (const [k, arr] of seen) {
      if (arr.length === 1) out[k] = arr[0].value;
    }
    return out;
  };

  return {
    tenancyByPropertyId,
    rlpByPropertyId,
    tenancyByKey: project(tenancyByPropertyId),
    rlpByKey: project(rlpByPropertyId),
    counts: {
      tenancies,
      withDepositId,
      rlpProtected: protectedCount,
      rlpWithout: withoutCount,
      rlpContradictory: contradictory,
    },
    computedAt: new Date().toISOString(),
  };
}

/**
 * Serve-stale-refresh-behind, identical in shape to getPortfolioBook. Returns
 * null only before the very first walk of a fresh deploy with no durable
 * cache — every caller must treat null as "not loaded yet", never as "no
 * tenancies".
 */
export async function getTenancyRegister(): Promise<TenancyRegister | null> {
  if (!cache) {
    const stored = await readCache<TenancyRegister>(CACHE_KEY).catch(() => null);
    if (stored) cache = { at: stored.at, data: stored.data };
  }
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (!running && Date.now() - failedAt > FAILURE_COOLDOWN_MS) {
    running = true;
    void (async () => {
      const data = await computeRegister();
      if (data) {
        cache = { at: Date.now(), data };
        lastError = null;
        failedAt = 0;
        await writeCache(CACHE_KEY, data);
      } else {
        lastError = "PayProp returned no tenants or instructions.";
        failedAt = Date.now();
      }
    })()
      .catch((e: unknown) => {
        lastError = e instanceof Error ? e.message : String(e);
        failedAt = Date.now();
      })
      .finally(() => {
        running = false;
      });
  }
  return cache?.data ?? null;
}
