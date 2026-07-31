import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { payPropConfigured } from "@/lib/payprop";
import { getAgentEarnings, describeAgentMatch, payPropRefreshing } from "@/lib/payprop-income";
import { SNAPSHOT_MONTH } from "@/lib/seed-data";
import type { AgentEarnings } from "@/lib/payprop-income";

// The signed-in partner's own commission, live from PayProp. Matched on their
// email, which is both their portal login and their PayProp beneficiary
// address.
//
// GET /api/my/earnings?month=YYYY-MM           → { earnings, refreshing }
// GET /api/my/earnings?months=YYYY-MM,YYYY-MM  → the same, per month, plus the
//                                                period total
//
// getAgentEarnings is fully month-parameterised (it walks report/all-payments
// with from_date/to_date), so a past month is a genuine answer, not a stand-in.
//
// Never blocks: the first call for a cold month returns null while the figures
// are gathered in the background, so the dashboard falls back to the snapshot
// rather than hanging on a slow walk through PayProp.
//
// AND NEVER PART-ANSWERS. A period total is only reported when every month in
// it came back matched — a three-month heading over a two-month sum is exactly
// the kind of smaller-but-plausible number nobody can tell is wrong.

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * How many months we'll walk in one request. Each cold month is ~40 sequential
 * PayProp calls and the shared range cache only holds six windows, so a
 * year-long ask would thrash it for everyone. Longer periods fall back to the
 * snapshot's monthly actuals, which the dashboard badges as such.
 */
const MAX_MONTHS = 6;

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  if (!payPropConfigured()) {
    return NextResponse.json({ connected: false, earnings: null });
  }

  // The snapshot the portal is written against, never the wall clock — exactly
  // as /api/my/stats does it. The two routes have to agree about which month is
  // live: on the clock, a selection including a month past the snapshot had
  // this route walk PayProp for it (~40 sequential calls each) while stats put
  // the same month in `future` and returned nothing for it. And with no ?month
  // at all, the default asked PayProp for a month the portal has nothing for.
  const liveMonth = SNAPSHOT_MONTH;
  const params = req.nextUrl.searchParams;
  const raw = params.get("months") ?? params.get("month") ?? "";
  const asked = [
    ...new Set(raw.split(",").map((m) => m.trim()).filter((m) => MONTH_RE.test(m))),
  ].sort();
  const requested = asked.length ? asked : [liveMonth];
  // A month that hasn't started has no payments — counting it as £0 would drag
  // the period's average down as though the partner had earned nothing.
  const future = requested.filter((m) => m > liveMonth);
  const months = requested.filter((m) => m <= liveMonth);
  const tooLong = months.length > MAX_MONTHS;

  const byMonth = tooLong
    ? []
    : await Promise.all(
        months.map(async (m) => ({
          month: m,
          earnings: await getAgentEarnings(user.email, m, user.name ?? "").catch(() => null),
        }))
      );

  // Complete = every month answered AND matched a PayProp beneficiary. Anything
  // less and the period figure stays null; the dashboard keeps the snapshot and
  // asks again while the background walk finishes.
  const answered = byMonth.filter(
    (r): r is { month: string; earnings: AgentEarnings } => r.earnings != null
  );
  const matched = answered.length > 0 && answered.every((r) => r.earnings.matched);
  const complete = months.length > 0 && answered.length === months.length && matched;

  const categories = new Map<string, number>();
  if (complete) {
    for (const r of answered) {
      for (const c of r.earnings.byCategory) {
        categories.set(c.category, (categories.get(c.category) ?? 0) + c.amount);
      }
    }
  }

  // ?debug=1 explains the match instead of leaving an unmatched partner as an
  // unexplained snapshot. Scoped to the signed-in user's own lookup.
  const debug = params.get("debug")
    ? await describeAgentMatch(user.email, user.name ?? "").catch((e: unknown) => ({
        error: e instanceof Error ? e.message : String(e),
      }))
    : undefined;

  const last = months[months.length - 1] ?? requested[requested.length - 1];
  return NextResponse.json({
    connected: true,
    // The single-month shape the dashboard has always read, unchanged.
    month: last,
    earnings: byMonth.find((r) => r.month === last)?.earnings ?? null,
    // The period shape.
    months,
    future,
    byMonth,
    period: {
      months,
      earned: complete ? answered.reduce((t, r) => t + r.earnings.earned, 0) : null,
      matched,
      complete,
      /** Months we asked for and haven't got an answer for yet. */
      missing: months.filter((m) => !answered.some((r) => r.month === m)),
      byCategory: [...categories.entries()]
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount),
      ...(tooLong
        ? {
            unavailable: `PayProp is only walked ${MAX_MONTHS} months at a time — a longer window falls back to the monthly snapshot figures.`,
          }
        : {}),
    },
    refreshing: payPropRefreshing(),
  });
}
