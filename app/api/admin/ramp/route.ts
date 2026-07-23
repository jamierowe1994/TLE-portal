import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { getTegHeadcount } from "@/lib/teg-hub";
import { getAgentRampCounts } from "@/lib/rex-stats";
import { getAgentMoveInsInWindow } from "@/lib/propoly-deals";
import { rexConfigured, rexLettingsAgents } from "@/lib/rex";
import { loadSnapshot, saveSnapshot } from "@/lib/propoly-snapshot";

// Partner ramp-time report — the YTD new-starter cohort cross-referenced
// across all three systems the user named:
//   • WHO + WHEN — TEG Team Hub (base44): partners whose date_launched falls
//     this year, with their rex_id.
//   • MAs + Listings in the first 60 days — REX (agent_1_id / listing_agent
//     within [launch, launch+60d]).
//   • Move-ins within 60 days — Propoly completed deals matched to the agent.
// The frontend filters this cohort by the selected period pill and sums the
// tiles. Ramp windows run to today for starters still inside their 60 days.

const RAMP_WINDOW_DAYS = 60;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CONCURRENCY = 6;

export interface RampStarter {
  name: string;
  email: string | null;
  dateLaunched: string; // YYYY-MM-DD
  /** REX user id resolved by EMAIL (TEG's rex_id is a different id space). */
  rexId: string | null;
  /** End of the 60-day window, clamped to today. */
  windowEnd: string;
  marketAppraisals: number | null;
  listings: number | null;
  moveIns: number | null;
}
interface RampPayload {
  starters: RampStarter[];
  generatedAt: string;
}

const cache = new Map<string, { at: number; data: RampPayload }>();
const inflight = new Map<string, Promise<RampPayload | null>>();

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

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function compute(year: string): Promise<RampPayload | null> {
  const [teg, rexAgents] = await Promise.all([
    getTegHeadcount().catch(() => null),
    rexConfigured() ? rexLettingsAgents().catch(() => []) : Promise.resolve([]),
  ]);
  if (!teg) return null;
  // TEG's rex_id is NOT the REX user id — resolve the real id by email.
  const rexIdByEmail = new Map(rexAgents.map((a) => [a.email.toLowerCase(), a.id]));
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${year}-01-01`;

  const cohort = teg.agents.filter(
    (a) => a.dateLaunched && a.dateLaunched >= yearStart && a.dateLaunched <= today
  );

  const starters = await mapLimit(cohort, CONCURRENCY, async (a): Promise<RampStarter> => {
    const launch = a.dateLaunched!;
    const windowEnd = minIso(addDays(launch, RAMP_WINDOW_DAYS), today);
    const rexId = a.email ? (rexIdByEmail.get(a.email.toLowerCase()) ?? null) : null;
    const rex = rexId
      ? await getAgentRampCounts(rexId, launch, windowEnd).catch(() => null)
      : null;
    const moveIns = await getAgentMoveInsInWindow(
      { email: a.email, name: a.name },
      launch,
      windowEnd
    ).catch(() => null);
    return {
      name: a.name,
      email: a.email ?? null,
      dateLaunched: launch,
      rexId,
      windowEnd,
      marketAppraisals: rex?.marketAppraisals ?? null,
      listings: rex?.listings ?? null,
      moveIns,
    };
  });

  return { starters, generatedAt: new Date().toISOString() };
}

function minIso(a: string, b: string): string {
  return a < b ? a : b;
}

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = userId ? await findById(userId) : null;
  if (!admin || !isAdminEmail(admin.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const year = String(new Date().getUTCFullYear());
  const force = req.nextUrl.searchParams.get("refresh") === "1";
  const key = `ramp:${year}`;

  const cached = cache.get(year);
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ configured: true, ...cached.data, cached: true });
  }

  // Stale-while-revalidate — the cohort sweep is ~2 REX calls per starter,
  // so serve the last-good cohort instantly and refresh in the background.
  if (!force) {
    const lastGood =
      cached?.data ??
      (await loadSnapshot<RampPayload>(key).catch(() => null))?.data ??
      null;
    if (lastGood) {
      if (!inflight.has(year)) {
        const job = compute(year)
          .then((d) => {
            if (d) {
              cache.set(year, { at: Date.now(), data: d });
              void saveSnapshot(key, d);
            }
            return d;
          })
          .catch(() => null)
          .finally(() => inflight.delete(year));
        inflight.set(year, job);
      }
      return NextResponse.json({ configured: true, ...lastGood, cached: true, stale: true });
    }
  }

  let job = inflight.get(year);
  if (!job || force) {
    job = compute(year)
      .then((d) => {
        if (d) {
          cache.set(year, { at: Date.now(), data: d });
          void saveSnapshot(key, d);
        }
        return d;
      })
      .catch(() => null)
      .finally(() => inflight.delete(year));
    inflight.set(year, job);
  }
  const data = await job;
  if (!data) {
    return NextResponse.json({ configured: false, starters: [] });
  }
  return NextResponse.json({ configured: true, ...data, cached: false });
}
