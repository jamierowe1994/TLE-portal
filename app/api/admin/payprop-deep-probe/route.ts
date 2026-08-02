import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import {
  payPropAccounts,
  payPropConfigured,
  payPropLabel,
  payPropRaw,
  type PayPropAccountId,
} from "@/lib/payprop";

// The kitchen-sink PayProp probe, built for one question: what does this API
// hold that could serve as a source of truth for compliance, deposits, or
// tenancy state — beyond the six endpoints the portal already reads?
//
// Context: launch is ~2 weeks out and third parties are slow, so anything we
// can self-serve from an API we already have credentials for beats anything we
// have to request. The holding-fee probe established the discovery pattern
// (payPropRaw reports real HTTP status, so 404 ≠ empty); this widens it to
// every plausible endpoint and adds a compliance-flavoured free-text sweep.
//
// Read-only: every call is a GET through the SAME shared throttle as live
// traffic (2.5 req/s) — a probe that bypassed it would trip the 429 lockout
// the dashboards share.
//
// GET /api/admin/payprop-deep-probe
//     ?accounts=uk       one agency only (default both)
//     ?pages=2           pages of 25 sampled per working endpoint (max 8)
//     ?full=1            include 2 full sample rows per endpoint, not just keys

// Known-good controls first — if these don't 200, credentials are the problem
// and every 404 below is meaningless.
const CONTROLS = ["export/properties", "export/invoices", "report/all-payments"];

const CANDIDATES = [
  // Entities we have never opened. export/tenants is the big one: if it
  // carries tenancy dates and deposit fields, it is a per-tenancy source of
  // truth with a property id already attached.
  "export/tenants",
  "export/payments",
  "export/agency",
  "export/landlords",
  // Category vocabularies. An invoice category named "Holding deposit" or a
  // payment category for deposits would settle where that money is coded.
  "invoices/categories",
  "payments/categories",
  "maintenance/categories",
  // Maintenance tickets: gas/electrical repairs often reference certificates.
  "maintenance/tickets",
  // Documents/attachments, in every naming convention PayProp might use.
  "documents",
  "attachments",
  "export/documents",
  "export/attachments",
  "report/documents",
  // Deposits, again — the holding-fee probe tried report/deposits and
  // export/deposits; these are the remaining spellings.
  "deposits",
  "export/tenant-deposits",
  "report/tenant/deposits",
  "report/deposit/summary",
  // Statements and summaries that might itemise per property.
  "report/tenant/statement",
  "report/owner/statement",
  "report/agency/income",
  "report/rental-statements",
  // Config surfaces.
  "webhooks",
  "tags",
  "meta/categories",
  ...CONTROLS,
];

// Anything compliance-, deposit- or tenancy-flavoured in free text.
const SWEEP =
  /deposit|\bdps\b|\btds\b|custodial|insur|scheme|\brlp\b|\bplc\b|holding|guarantee|right.{0,3}to.{0,3}rent|referenc|\bepc\b|\bgas\b|eicr|electric|certificat|licen[cs]e|\bhmo\b|legionella|smoke|alarm|inventory|agreement/i;

function rowsOf(json: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(json)) return json as Array<Record<string, unknown>>;
  if (!json || typeof json !== "object") return [];
  const obj = json as Record<string, unknown>;
  const named = obj.items ?? obj.balances ?? obj.categories ?? obj.data ?? obj.results;
  if (Array.isArray(named)) return named as Array<Record<string, unknown>>;
  const first = Object.values(obj).find((v) => Array.isArray(v));
  return Array.isArray(first) ? (first as Array<Record<string, unknown>>) : [];
}

/** Every string leaf with its path, so a nested hit still says where it lives. */
function strings(
  node: unknown,
  path = "",
  out: Array<{ path: string; value: string }> = []
) {
  if (typeof node === "string") {
    if (node.trim()) out.push({ path, value: node });
    return out;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      strings(v, path ? `${path}.${k}` : k, out);
    }
  }
  return out;
}

/** Key paths (dot-notation, arrays collapsed) so nested shapes are visible. */
function keyPaths(node: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 3)) keyPaths(item, prefix, out);
    return out;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.add(p);
    if (v && typeof v === "object") keyPaths(v, p, out);
  }
  return out;
}

/* ------------------------------- census mode ------------------------------- */

/** Walk one endpoint to exhaustion, reporting whether the cap cut it short. */
async function walkAll(
  account: PayPropAccountId,
  path: string,
  maxPages: number
): Promise<{ rows: Array<Record<string, unknown>>; pages: number; truncated: boolean }> {
  const rows: Array<Record<string, unknown>> = [];
  let pages = 0;
  for (let page = 1; page <= maxPages; page++) {
    const res = await payPropRaw(account, path, { rows: 25, page });
    if (!res.ok) break;
    pages++;
    const batch = rowsOf(res.json);
    rows.push(...batch);
    if (batch.length < 25) return { rows, pages, truncated: false };
  }
  // Ending on a full page at the cap means there was more. Say so — a silent
  // cap reads as "covered everything" when it didn't.
  return { rows, pages, truncated: pages === maxPages };
}

const RLP_PROTECTED = /protected\s+with\s+rlp/i;
const RLP_WITHOUT = /without\s+rlp/i;

async function runCensus(accounts: PayPropAccountId[]) {
  const perAccount: Record<string, unknown> = {};

  for (const account of accounts) {
    // ---- every property, so "unmentioned" is a real bucket ----
    const props = await walkAll(account, "export/properties", 40);
    const propName = new Map<string, string>();
    for (const p of props.rows) {
      const id = String(p.id ?? "");
      if (id) propName.set(id, String(p.property_name ?? ""));
    }

    // ---- RLP per property, from payment-instruction descriptions ----
    // Instructions carry a real property.id, so this join is exact — no
    // address matching anywhere.
    const pays = await walkAll(account, "export/payments", 100);
    const rlpEvidence = new Map<
      string,
      { protected: string[]; without: string[] }
    >();
    for (const row of pays.rows) {
      const pid = String(
        (row.property as Record<string, unknown> | undefined)?.id ?? ""
      );
      if (!pid) continue;
      const texts = [row.description, row.beneficiary_reference]
        .map((v) => String(v ?? ""))
        .filter(Boolean);
      for (const t of texts) {
        const hitP = RLP_PROTECTED.test(t);
        const hitW = RLP_WITHOUT.test(t);
        if (!hitP && !hitW) continue;
        const e = rlpEvidence.get(pid) ?? { protected: [], without: [] };
        const note =
          t.slice(0, 120) + (row.enabled === false ? " [instruction DISABLED]" : "");
        if (hitP && e.protected.length < 3) e.protected.push(note);
        if (hitW && e.without.length < 3) e.without.push(note);
        rlpEvidence.set(pid, e);
      }
    }
    const rlpProtected: Array<{ id: string; name: string; evidence: string }> = [];
    const rlpWithout: Array<{ id: string; name: string; evidence: string }> = [];
    const rlpContradictory: Array<{ id: string; name: string; evidence: string[] }> = [];
    for (const [pid, e] of rlpEvidence) {
      const name = propName.get(pid) ?? "(not in export/properties)";
      if (e.protected.length && e.without.length) {
        rlpContradictory.push({ id: pid, name, evidence: [...e.protected, ...e.without] });
      } else if (e.protected.length) {
        rlpProtected.push({ id: pid, name, evidence: e.protected[0] });
      } else {
        rlpWithout.push({ id: pid, name, evidence: e.without[0] });
      }
    }

    // ---- tenancy dates + deposit ids, from export/tenants ----
    const tens = await walkAll(account, "export/tenants", 80);
    let tenancies = 0;
    let withStart = 0;
    let withEnd = 0;
    let withDeposit = 0;
    let endingSoonCount = 0;
    let endedInPast = 0;
    const depositIds = new Set<string>();
    const statusTally = new Map<string, number>();
    const endingSoon: Array<{ property: string; endDate: string }> = [];
    const today = new Date().toISOString().slice(0, 10);
    const in90 = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    for (const t of tens.rows) {
      const status = String(t.status ?? "(blank)");
      statusTally.set(status, (statusTally.get(status) ?? 0) + 1);
      const properties = Array.isArray(t.properties) ? t.properties : [];
      for (const pr of properties as Array<Record<string, unknown>>) {
        const tn = (pr.tenant ?? {}) as Record<string, unknown>;
        tenancies++;
        const start = String(tn.start_date ?? "");
        const end = String(tn.end_date ?? "");
        const dep = String(tn.deposit_id ?? "");
        if (start) withStart++;
        if (end) withEnd++;
        if (dep) {
          withDeposit++;
          depositIds.add(dep);
        }
        if (end && end >= today && end <= in90) {
          endingSoonCount++;
          if (endingSoon.length < 50) {
            endingSoon.push({ property: String(pr.property_name ?? ""), endDate: end });
          }
        }
        if (end && end < today) endedInPast++;
      }
    }

    perAccount[payPropLabel(account)] = {
      walked: {
        properties: { rows: props.rows.length, pages: props.pages, truncated: props.truncated },
        paymentInstructions: { rows: pays.rows.length, pages: pays.pages, truncated: pays.truncated },
        tenants: { rows: tens.rows.length, pages: tens.pages, truncated: tens.truncated },
      },
      rlp: {
        // The whole point: coverage, not sightings. unmentioned is properties
        // whose instructions never say either way — silence, not "no cover".
        protected: rlpProtected.length,
        without: rlpWithout.length,
        contradictory: rlpContradictory,
        unmentioned: Math.max(0, propName.size - rlpEvidence.size),
        protectedList: rlpProtected.slice(0, 300),
        withoutList: rlpWithout.slice(0, 300),
      },
      tenancies: {
        tenantRows: tens.rows.length,
        tenancies,
        withStartDate: withStart,
        withEndDate: withEnd,
        withDepositId: withDeposit,
        distinctDepositIds: depositIds.size,
        endingWithin90Days: endingSoonCount,
        endedInThePast: endedInPast,
        statusValues: Object.fromEntries(statusTally),
        endingSoonSample: endingSoon,
      },
    };
  }

  return {
    configured: true,
    mode: "census",
    purpose:
      "Turn the discovery run's sightings into whole-book coverage: RLP (PLC) status " +
      "per property from payment-instruction descriptions, and tenancy dates + " +
      "deposit ids per tenancy from export/tenants.",
    caveats: [
      "RLP classification is from free text staff typed into payment instructions. Contradictory entries (both wordings on one property) are listed in full rather than resolved.",
      "unmentioned means the instructions say nothing either way — it is NOT evidence of no cover.",
      "Any truncated:true means a walk hit its page cap and the numbers under it are floors, not totals.",
    ],
    accounts: perAccount,
  };
}

export async function GET(req: NextRequest) {
  const adminId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = adminId ? await findById(adminId) : null;
  if (!admin) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!isAdminEmail(admin.email)) {
    return NextResponse.json(
      { error: "This area is locked to the business owner." },
      { status: 403 }
    );
  }
  if (!payPropConfigured()) return NextResponse.json({ configured: false });

  const q = req.nextUrl.searchParams;
  const only = (q.get("accounts") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const accounts = payPropAccounts().filter(
    (a) => only.length === 0 || only.includes(a)
  ) as PayPropAccountId[];
  // PayProp clamps rows to 25 whatever you ask for, so depth = pages.
  const pages = Math.min(Math.max(Number(q.get("pages") ?? 2), 1), 8);
  const full = q.get("full") === "1";

  // ?census=1 — the follow-up mode. The discovery run found RLP written BOTH
  // ways in export/payments descriptions ("Protected with RLP" / "Without
  // RLP") and per-tenancy dates + deposit_id in export/tenants. Hits in a
  // 50-row sample are a lead; this walks the whole book and turns them into
  // coverage numbers — the difference between "we saw it" and "we can build
  // on it". ~80 throttled calls per agency, allow a minute or two.
  if (q.get("census") === "1") {
    return NextResponse.json(await runCensus(accounts));
  }

  const perAccount: Record<string, unknown> = {};

  for (const account of accounts) {
    // ---- 1. discovery: one cheap call per candidate ----
    const discovery: Array<{
      path: string;
      status: number;
      rows: number | null;
      note: string | null;
    }> = [];
    const working: string[] = [];
    for (const path of CANDIDATES) {
      const res = await payPropRaw(account, path, { rows: 1, page: 1 });
      discovery.push({
        path,
        status: res.status,
        rows: res.ok ? rowsOf(res.json).length : null,
        note: res.ok ? null : (res.error ?? res.text?.slice(0, 120) ?? null),
      });
      if (res.ok) working.push(path);
    }

    // ---- 2. sample each working endpoint once, reuse for everything ----
    const endpoints: Record<string, unknown> = {};
    for (const path of working) {
      const rows: Array<Record<string, unknown>> = [];
      for (let page = 1; page <= pages; page++) {
        const res = await payPropRaw(account, path, { rows: 25, page });
        if (!res.ok) break;
        const batch = rowsOf(res.json);
        rows.push(...batch);
        if (batch.length < 25) break;
      }
      if (rows.length === 0) {
        endpoints[path] = { rows: 0, verdict: "exists but returned nothing" };
        continue;
      }

      // Compliance-flavoured hits anywhere in the payload, keys or values.
      const hits: Array<{ path: string; value: string }> = [];
      const seen = new Set<string>();
      for (const row of rows) {
        for (const s of strings(row)) {
          if (!SWEEP.test(s.path) && !SWEEP.test(s.value)) continue;
          const key = `${s.path}:${s.value.slice(0, 60)}`;
          if (seen.has(key) || hits.length >= 25) continue;
          seen.add(key);
          hits.push({ path: s.path, value: s.value.slice(0, 160) });
        }
      }

      // Per-field population, so "the field exists" and "the field is filled
      // in" stop being conflated — the service_level lesson.
      const population: Record<string, number> = {};
      for (const row of rows) {
        for (const [k, v] of Object.entries(row)) {
          if (v !== null && v !== undefined && v !== "") {
            population[k] = (population[k] ?? 0) + 1;
          }
        }
      }

      endpoints[path] = {
        rowsSampled: rows.length,
        keyPaths: [...keyPaths(rows)].sort(),
        population: Object.fromEntries(
          Object.entries(population).sort((a, b) => b[1] - a[1])
        ),
        complianceFlavouredText: hits,
        ...(full ? { sample: rows.slice(0, 2) } : {}),
      };
    }

    perAccount[payPropLabel(account)] = {
      discovery,
      working,
      endpoints,
    };
  }

  return NextResponse.json({
    configured: true,
    purpose:
      "Find every PayProp endpoint that could serve as a compliance/deposit/tenancy " +
      "source of truth. Controls (export/properties, export/invoices, " +
      "report/all-payments) MUST be 200 or the credentials are the problem.",
    howToRead: [
      "discovery: 404 = endpoint does not exist; 200 rows:0 = exists, empty.",
      "endpoints[path].population: how many of the sampled rows actually fill each field in — a field existing is not a field being used.",
      "endpoints[path].complianceFlavouredText: every string smelling of deposits/certificates/schemes, with its field path.",
      "Add ?full=1 for two whole sample rows per endpoint; ?pages=4 to sample 100 rows instead of 50.",
    ],
    accountsProbed: accounts.map(payPropLabel),
    accounts: perAccount,
  });
}
