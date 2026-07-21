import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { rexConfigured, rexLettingsAgents } from "@/lib/rex";
import { getAgentFunnel, getAgentPortfolio } from "@/lib/rex-stats";
import {
  getPropolyBusinessStats,
  type PropolyBusinessStats,
} from "@/lib/propoly-deals";
import { getTegHeadcount, type TegHeadcount } from "@/lib/teg-hub";
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
    generatedAt: new Date().toISOString(),
  };
  cache.set(month, { at: Date.now(), data });
  const debug = req.nextUrl.searchParams.get("debug") === "1";
  return NextResponse.json({ ...data, cached: false, ...(debug ? { perAgent: counted } : {}) });
}
