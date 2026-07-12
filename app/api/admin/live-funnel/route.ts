import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById, listUsers } from "@/lib/users-store";
import { getAgentFunnel, getAgentPortfolio } from "@/lib/rex-stats";
import { currentMonth } from "@/lib/format";

// Live REX totals across every agent linked to a REX user id — powers the
// admin "Live from REX" summary. Cached briefly (this fans out several REX
// calls per agent) and defensive: any agent that fails is simply skipped.

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CACHE_TTL_MS = 3 * 60 * 1000;
const CONCURRENCY = 5;

interface AgentLive {
  name: string;
  agentKey: string | null;
  marketAppraisals: number | null;
  listings: number | null;
  pipeline: number | null;
  managed: number | null;
  rentRoll: number | null;
}

interface Payload {
  month: string;
  linkedCount: number;
  totalAgents: number;
  totals: { marketAppraisals: number; listings: number; pipeline: number; managed: number; rentRoll: number };
  perAgent: AgentLive[];
}

const cache = new Map<string, { at: number; data: Payload }>();

// Run tasks with a small concurrency cap so we never hammer REX.
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

  const cached = cache.get(month);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.data, cached: true });
  }

  const users = await listUsers().catch(() => []);
  const linked = users.filter((u) => u.rexUserId);

  const perAgent = await mapLimit(linked, CONCURRENCY, async (u): Promise<AgentLive> => {
    const [funnel, portfolio] = await Promise.all([
      getAgentFunnel(u.rexUserId as string, month).catch(() => null),
      getAgentPortfolio(u.rexUserId as string).catch(() => null),
    ]);
    return {
      name: u.name,
      agentKey: u.agentKey ?? null,
      marketAppraisals: funnel?.marketAppraisals?.value ?? null,
      listings: funnel?.listings?.value ?? null,
      pipeline: funnel?.pipeline?.value ?? null,
      managed: portfolio?.managed ?? null,
      rentRoll: portfolio?.rentRoll ?? null,
    };
  });

  const sum = (k: keyof AgentLive) =>
    perAgent.reduce((t, a) => t + (typeof a[k] === "number" ? (a[k] as number) : 0), 0);

  const data: Payload = {
    month,
    linkedCount: linked.length,
    totalAgents: users.length,
    totals: {
      marketAppraisals: sum("marketAppraisals"),
      listings: sum("listings"),
      pipeline: sum("pipeline"),
      managed: sum("managed"),
      rentRoll: sum("rentRoll"),
    },
    perAgent,
  };
  cache.set(month, { at: Date.now(), data });
  return NextResponse.json({ ...data, cached: false });
}
