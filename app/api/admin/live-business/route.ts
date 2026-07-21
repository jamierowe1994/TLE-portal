import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { rexConfigured, rexLettingsAgents } from "@/lib/rex";
import {
  getAgentFunnel,
  getAgentPortfolio,
  getBusinessMonthCounts,
  type BusinessMonthCounts,
} from "@/lib/rex-stats";
import {
  getPropolyBusinessStats,
  type PropolyBusinessStats,
} from "@/lib/propoly-deals";
import { getTegHeadcount, tegHubConfigured, type TegHeadcount } from "@/lib/teg-hub";
import { propolyConfigured } from "@/lib/propoly";
import { currentMonth } from "@/lib/format";

// Business-wide LIVE figures from two sources:
//   REX     — every lettings agent's funnel + portfolio, summed (heavy,
//             cached, concurrency-limited).
//   Propoly — the whole progression pipeline by stage + completed move-ins
//             for the month (cached inside lib/propoly-deals).
// Propoly answers even when REX isn't configured, so the admin Overview can
// upgrade whatever it can rather than all-or-nothing.

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CONCURRENCY = 8;

interface Totals {
  marketAppraisals: number;
  onMarketListings: number;
  pipeline: number;
  managed: number;
  rentRoll: number;
}
interface Payload {
  month: string;
  agentsCounted: number; // agents that returned any live figure
  agentsTotal: number; // lettings agents found in REX
  totals: Totals;
  propoly: PropolyBusinessStats | null;
  teg: TegHeadcount | null;
  /** Month-bound REX counts (applications by date_received, listings created). */
  monthCounts: BusinessMonthCounts | null;
  /** Live MA split by partner type — REX per-agent MAs × TEG Hub dual flag. */
  masByType: { total: number; tle: number; tleDual: number; unmatched: number } | null;
  generatedAt: string;
}

const cache = new Map<string, { at: number; data: Payload }>();

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = userId ? await findById(userId) : null;
  if (!admin || !isAdminEmail(admin.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const monthParam = req.nextUrl.searchParams.get("month");
  const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : currentMonth();
  const force = req.nextUrl.searchParams.get("refresh") === "1";

  if (!rexConfigured()) {
    // No REX here — Propoly and the Team Hub still answer (own caches).
    const [propoly, teg] = await Promise.all([
      getPropolyBusinessStats(month).catch(() => null),
      getTegHeadcount().catch(() => null),
    ]);
    return NextResponse.json({ configured: false, month, propoly, teg }, { status: 200 });
  }

  const cached = cache.get(month);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.data, cached: true });
  }

  const [agents, propoly, teg] = await Promise.all([
    rexLettingsAgents(),
    getPropolyBusinessStats(month).catch(() => null),
    getTegHeadcount(force).catch(() => null),
  ]);

  const monthCounts = await getBusinessMonthCounts(
    month,
    agents.map((a) => a.id),
    force
  ).catch(() => null);

  const rows = await mapLimit(agents, CONCURRENCY, async (a) => {
    const [funnel, portfolio] = await Promise.all([
      getAgentFunnel(a.id, month).catch(() => null),
      getAgentPortfolio(a.id).catch(() => null),
    ]);
    if (!funnel && !portfolio) return null;
    return {
      email: a.email,
      marketAppraisals: funnel?.marketAppraisals?.value ?? 0,
      onMarketListings: funnel?.listings?.value ?? 0,
      pipeline: funnel?.pipeline?.value ?? 0,
      managed: portfolio?.managed ?? 0,
      rentRoll: portfolio?.rentRoll ?? 0,
    };
  });

  const counted = rows.filter((r): r is NonNullable<typeof r> => r != null);

  // MA split by partner type: REX gives per-agent MAs, the Team Hub says who's
  // dual-brand. Match on email first, then "first.last" against the REX email
  // local part (hub emails aren't always the @thelettingexperts.co.uk one).
  let masByType: Payload["masByType"] = null;
  if (teg) {
    const dualKeys = new Set<string>();
    const primaryKeys = new Set<string>();
    for (const a of teg.agents) {
      const keys = [
        a.email?.toLowerCase(),
        a.name.toLowerCase().replace(/[^a-z]+/g, "."),
      ].filter((k): k is string => Boolean(k));
      for (const k of keys) (a.dual ? dualKeys : primaryKeys).add(k);
    }
    let tle = 0;
    let tleDual = 0;
    let unmatched = 0;
    for (const r of counted) {
      const email = r.email.toLowerCase();
      const local = email.split("@")[0];
      const isDual = dualKeys.has(email) || dualKeys.has(local);
      const isPrimary = primaryKeys.has(email) || primaryKeys.has(local);
      if (isDual) tleDual += r.marketAppraisals;
      else if (isPrimary) tle += r.marketAppraisals;
      else unmatched += r.marketAppraisals;
    }
    masByType = { total: tle + tleDual + unmatched, tle: tle + unmatched, tleDual, unmatched };
  }

  const totals: Totals = {
    marketAppraisals: counted.reduce((t, r) => t + r.marketAppraisals, 0),
    onMarketListings: counted.reduce((t, r) => t + r.onMarketListings, 0),
    pipeline: counted.reduce((t, r) => t + r.pipeline, 0),
    managed: counted.reduce((t, r) => t + r.managed, 0),
    rentRoll: counted.reduce((t, r) => t + r.rentRoll, 0),
  };

  const data: Payload = {
    month,
    agentsCounted: counted.length,
    agentsTotal: agents.length,
    totals,
    propoly,
    teg,
    monthCounts,
    masByType,
    generatedAt: new Date().toISOString(),
  };
  // Only cache a COMPLETE payload — a Propoly/TEG timeout on a cold run must
  // not freeze `null` into everyone's dashboard for the next five minutes.
  const propolyOk = !propolyConfigured() || propoly != null;
  const tegOk = !tegHubConfigured() || teg != null;
  if (propolyOk && tegOk) cache.set(month, { at: Date.now(), data });
  const debug = req.nextUrl.searchParams.get("debug") === "1";
  return NextResponse.json({ ...data, cached: false, ...(debug ? { perAgent: counted } : {}) });
}
