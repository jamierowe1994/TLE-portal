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
