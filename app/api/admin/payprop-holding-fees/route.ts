import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import {
  payPropAccounts,
  payPropConfigured,
  payPropLabel,
  payPropRaw,
  payPropGetAll,
  type PayPropAccountId,
} from "@/lib/payprop";
import { getAllPropolyDeals } from "@/lib/propoly-deals";

// Find the holding fee in PayProp.
//
// Susan, verbatim: "Sent to PayProp from Propoly and held in unreconcilled
// funds with a note to reference which property until the let progresses then
// the property record is created - now automatically via integration with REX
// CRM and Propoly".
//
// That explains why the earlier audit drew a blank. It censused payment
// CATEGORIES across 400 rows of report/all-payments and found no holding fee —
// correctly, because all-payments is money going OUT. A holding fee sitting in
// unreconciled funds has not been allocated to anything yet, so it has no
// category and no payment row. We were looking at the wrong end of the ledger.
//
// This probe answers three questions, in order:
//
//   1. WHICH ENDPOINT holds unreconciled money? PayProp's published spec $refs
//      a definitions file we don't have, so the endpoint list below is
//      candidates, not knowledge. payPropRaw reports real HTTP status, so a
//      404 ("no such endpoint") is distinguishable from 200-with-no-rows
//      ("right endpoint, nothing in it") — which payPropGet cannot do, since
//      it returns null for both.
//   2. WHAT SHAPE are the rows, and which field carries Susan's note?
//   3. CAN WE JOIN IT to a property? Every live Propoly deal at the holding-fee
//      stage carries an address and an amount. If a note mentions the address,
//      or an amount matches, the join is real. If the notes turn out to be
//      freehand, that is the finding — better to know now than to promise a
//      feature built on a fuzzy string match.
//
// Read-only: every call is a GET.
//
// GET /api/admin/payprop-holding-fees
//     ?accounts=uk           limit to one agency (default: both)
//     ?rows=100              rows to sample per working endpoint (default 50)
//     ?full=1                include full sample rows, not just keys

// Candidates. Ordered most- to least-likely; unknown ones cost one call each
// and their 404s are as informative as the 200s.
const CANDIDATES = [
  // Incoming money — where an unreconciled holding fee should live.
  "report/icdn",
  "export/incoming-transactions",
  "report/incoming-transactions",
  "report/unreconciled",
  "report/unallocated",
  "export/unreconciled-payments",
  "report/payments/unreconciled",
  "export/transactions",
  "report/transactions",
  // Balances — money held but not paid on.
  "report/agency/balances",
  "report/beneficiary/balances",
  "report/tenant/balances",
  "report/processing-summary",
  // Deposits and holds.
  "report/deposits",
  "export/deposits",
  "report/holding-deposits",
  // Known-good, included as controls: if these 200 and the rest 404, the
  // credentials are fine and the endpoints genuinely do not exist.
  "report/all-payments",
  "export/properties",
  "export/invoices",
];

// Field names that could plausibly carry "a note to reference which property".
const NOTE_KEYS =
  /note|description|reference|remark|narrative|comment|memo|detail|label|subject|text/i;

const money = (v: unknown) => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
};

/** Address tokens worth matching on: house numbers and real street words. */
const NOISE = new Set([
  "FLAT", "ROOM", "APARTMENT", "THE", "AND", "ROAD", "STREET", "LANE",
  "AVENUE", "CLOSE", "DRIVE", "COURT", "HOUSE", "WAY", "PLACE", "GARDENS",
]);
function tokens(s: string): { numbers: string[]; words: string[] } {
  const u = s.toUpperCase();
  return {
    numbers: [...new Set(u.match(/\d+[A-Z]?/g) ?? [])],
    words: [...new Set((u.match(/[A-Z]{4,}/g) ?? []).filter((w) => !NOISE.has(w)))],
  };
}

/** Every string in a row, with its path — the note could be nested. */
function strings(node: unknown, path = "", out: Array<{ path: string; value: string }> = []) {
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

function rowsOf(json: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(json)) return json as Array<Record<string, unknown>>;
  if (!json || typeof json !== "object") return [];
  const obj = json as Record<string, unknown>;
  const named = obj.items ?? obj.balances ?? obj.data ?? obj.results;
  if (Array.isArray(named)) return named as Array<Record<string, unknown>>;
  const first = Object.values(obj).find((v) => Array.isArray(v));
  return Array.isArray(first) ? (first as Array<Record<string, unknown>>) : [];
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
  const sampleRows = Math.min(Math.max(Number(q.get("rows") ?? 50), 1), 200);
  const full = q.get("full") === "1";
  // The service-level census walks the WHOLE property book — ~40 pages per
  // account at 25 rows a page, throttled to 2.5/s. Off by default so the
  // ordinary probe stays inside a request timeout; ?census=1 when you want the
  // real distribution rather than the first 25.
  const census = q.get("census") === "1";

  // The deals we are trying to find money for. Only the holding-fee stage and
  // the one before it — a fee taken for a deal already past PLC has usually
  // been reconciled away, so it would be a miss for the right reason and would
  // make the hit rate below read worse than it is.
  const deals = await getAllPropolyDeals().catch(() => null);
  const wanted = (deals ?? [])
    .filter((d) => d.statusKey === "holding_fee" || d.statusKey === "start_deal")
    .map((d) => ({
      id: d.app.id,
      address: d.app.propertyName,
      locality: d.app.locality,
      holdingFee: d.app.propoly?.holdingFee ?? null,
      agent: d.managerName,
      tokens: tokens(`${d.app.propertyName} ${d.app.locality}`),
    }));

  const perAccount: Record<string, unknown> = {};

  for (const account of accounts) {
    // ---- 1. which endpoints exist? ----
    const discovery: Array<{
      path: string;
      status: number;
      rows: number | null;
      note: string | null;
    }> = [];
    const working: string[] = [];

    for (const path of CANDIDATES) {
      const res = await payPropRaw(account, path, { rows: 1, page: 1 });
      const n = res.ok ? rowsOf(res.json).length : null;
      discovery.push({
        path,
        status: res.status,
        rows: n,
        note: res.ok ? null : (res.error ?? res.text?.slice(0, 140) ?? null),
      });
      if (res.ok) working.push(path);
    }

    // ---- 2. shapes, and where the free text lives ----
    // Sampled ONCE per endpoint and reused for the join below. The throttle is
    // 2.5 req/s and shared with every live dashboard, so a probe that fetched
    // the same pages twice would be taking that budget from real traffic.
    const sampled = new Map<string, Array<Record<string, unknown>>>();
    for (const path of working) {
      const res = await payPropRaw(account, path, { rows: sampleRows, page: 1 });
      sampled.set(path, rowsOf(res.json));
    }

    const endpoints: Record<string, unknown> = {};
    for (const path of working) {
      const rows = sampled.get(path) ?? [];
      if (rows.length === 0) {
        endpoints[path] = { rows: 0, verdict: "endpoint exists but returned nothing" };
        continue;
      }

      // Which paths in these rows carry free text, and what does it look like?
      const textFields = new Map<string, Set<string>>();
      for (const row of rows) {
        for (const s of strings(row)) {
          if (!NOTE_KEYS.test(s.path)) continue;
          const set = textFields.get(s.path) ?? new Set<string>();
          if (set.size < 8) set.add(s.value.slice(0, 160));
          textFields.set(s.path, set);
        }
      }

      endpoints[path] = {
        rows: rows.length,
        keys: Object.keys(rows[0]).sort(),
        // Every field that could be Susan's note, with real examples. This is
        // the bit that answers "what does the note actually say".
        freeTextFields: Object.fromEntries(
          [...textFields].map(([k, v]) => [k, [...v]])
        ),
        sample: full ? rows.slice(0, 3) : Object.keys(rows[0]).sort(),
      };
    }

    // ---- 3. can we join a row to a property? ----
    // Scored per deal against every row of every working endpoint. An address
    // token hit is worth far more than an amount hit: amounts collide (plenty
    // of £500 holding fees), addresses don't.
    const matches: Array<Record<string, unknown>> = [];
    const unmatched: string[] = [];

    const pool: Array<{ endpoint: string; row: Record<string, unknown>; text: string }> = [];
    for (const path of working) {
      for (const row of sampled.get(path) ?? []) {
        pool.push({
          endpoint: path,
          row,
          text: strings(row)
            .filter((s) => NOTE_KEYS.test(s.path))
            .map((s) => s.value)
            .join(" | ")
            .toUpperCase(),
        });
      }
    }

    // A match REQUIRES a street word. The first version scored a house number
    // at 2 and passed anything reaching 3, so two digits cleared the bar with
    // no street name involved at all — "52 Moor Street" matched the landlord
    // registration number "1520261/380/21122", and "22 Ryecroft Way" matched
    // "Annual Rent - 22 Abacus Drive". 7 of 10 reported matches were that.
    // Numbers now only separate two candidates that both hit on the name.
    for (const w of wanted) {
      let best: {
        words: string[];
        score: number;
        endpoint: string;
        text: string;
        amount: number | null;
      } | null = null;
      for (const p of pool) {
        if (!p.text) continue;
        const words = w.tokens.words.filter((word) => p.text.includes(word));
        if (words.length === 0) continue; // no street name → not a candidate
        let score = words.length * 3;
        for (const n of w.tokens.numbers) if (p.text.includes(n)) score += 1;
        const amt = money(p.row.amount ?? p.row.gross_amount ?? p.row.value);
        if (w.holdingFee != null && amt != null && Math.abs(amt - w.holdingFee) < 0.01) {
          score += 1; // tie-breaker only — amounts collide, addresses don't
        }
        if (score > (best?.score ?? 0)) {
          best = { words, score, endpoint: p.endpoint, text: p.text.slice(0, 200), amount: amt };
        }
      }
      if (best) {
        matches.push({
          deal: `${w.address}, ${w.locality}`,
          agent: w.agent,
          propolyHoldingFee: w.holdingFee,
          matchedOn: best.endpoint,
          matchedWords: best.words,
          score: best.score,
          payPropAmount: best.amount,
          payPropText: best.text,
          // Even a true address match is usually a RENT line, not a holding
          // fee. Say so rather than letting the match imply otherwise.
          looksLikeHoldingFee:
            w.holdingFee != null &&
            best.amount != null &&
            Math.abs(best.amount - w.holdingFee) < 0.01,
        });
      } else {
        unmatched.push(`${w.address}, ${w.locality}`);
      }
    }

    // ---- 4. service level, and RLP ----
    // Two things fell out of the first run that matter more than the holding
    // fee did.
    //
    // export/properties carries a `service_level` field — a STRUCTURED answer
    // to "what has this landlord bought", which is what REX's empty
    // lettings_service_type was supposed to be.
    //
    // And the free text is full of "Without RLP": "Experts Managed Service-
    // Without RLP- Lianna Denholm", "Experts Managed Service (10%+VAT)-
    // Without RLP- MHK Lettings (Margo Wilson)". RLP is rent & legal
    // protection — the PLC we could not find anywhere in REX or Propoly. If
    // staff mark it consistently, PayProp already knows who has it.
    const serviceLevels = new Map<string, number>();
    const propertyRows = census
      ? await payPropGetAll<Record<string, unknown>>(account, "export/properties")
      : (sampled.get("export/properties") ?? []);
    for (const row of propertyRows) {
      const lvl = row.service_level;
      const key =
        lvl == null || lvl === ""
          ? "(blank)"
          : typeof lvl === "object"
            ? JSON.stringify(lvl)
            : String(lvl);
      serviceLevels.set(key, (serviceLevels.get(key) ?? 0) + 1);
    }

    const RLP = /\brlp\b|rent.{0,12}legal|legal.{0,12}protect|\bplc\b/i;
    const rlpHits: Array<{ endpoint: string; path: string; text: string }> = [];
    const rlpCounts = { mentioning: 0, saysWithout: 0, saysWith: 0 };
    for (const [path, rows] of sampled) {
      for (const row of rows) {
        for (const s of strings(row)) {
          if (!RLP.test(s.value)) continue;
          rlpCounts.mentioning++;
          if (/without\s+rlp/i.test(s.value)) rlpCounts.saysWithout++;
          else if (/with\s+rlp|\+\s*rlp|incl.{0,4}rlp/i.test(s.value)) rlpCounts.saysWith++;
          if (rlpHits.length < 30) {
            rlpHits.push({ endpoint: path, path: s.path, text: s.value.slice(0, 180) });
          }
        }
      }
    }

    perAccount[payPropLabel(account)] = {
      discovery,
      working,
      endpoints,
      serviceLevel: {
        propertiesCounted: propertyRows.length,
        complete: census,
        byLevel: Object.fromEntries(
          [...serviceLevels].sort((a, b) => b[1] - a[1])
        ),
      },
      rlp: {
        ...rlpCounts,
        note:
          "RLP = rent & legal protection, i.e. the PLC we could not find in REX " +
          "or Propoly. 'saysWithout' vastly outnumbering 'saysWith' may mean " +
          "staff only ever write the exception — in which case silence is not " +
          "evidence of cover and this cannot be inverted.",
        examples: rlpHits,
      },
      join: {
        dealsLookedFor: wanted.length,
        rowsSearched: pool.length,
        matched: matches.length,
        matches: matches.slice(0, 25),
        unmatched: unmatched.slice(0, 25),
      },
    };
  }

  return NextResponse.json({
    configured: true,
    susanSaid:
      "Sent to PayProp from Propoly and held in unreconcilled funds with a note " +
      "to reference which property until the let progresses then the property " +
      "record is created - now automatically via integration with REX CRM and Propoly",
    howToRead: [
      "1. `discovery` — status per candidate endpoint. 404 = no such endpoint. 200 with rows:0 = right endpoint, nothing in it. The known-good controls (report/all-payments, export/properties, export/invoices) MUST be 200; if they are not, the credentials are the problem and nothing else here means anything.",
      "2. `endpoints[path].freeTextFields` — every field that could carry Susan's note, with real examples. This is what tells us the note format.",
      "3. `join` — how many live holding-fee deals we could tie to a PayProp row by address. A high match rate means this is buildable; a low one means the notes are freehand and it is a fuzzy match, which is worth knowing before anyone promises the feature.",
    ],
    accountsProbed: accounts.map(payPropLabel),
    propolyDealsInScope: wanted.length,
    accounts: perAccount,
  });
}
