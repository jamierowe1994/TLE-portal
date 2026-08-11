import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { getGciHistory, MONEY_FLOOR } from "@/lib/gci-history";
import { currentMonth } from "@/lib/format";

/**
 * Walk PayProp month by month and STORE each month's commission.
 *
 * GET /api/admin/gci-backfill?from=2026-01[&to=2026-08]
 *
 * This exists because getAgencyIncome is non-blocking by design: on a cold key
 * it returns null immediately and computes behind. That is right for a page
 * load and useless for a backfill — asking for eight cold months returns eight
 * nulls and stores nothing, which is why the money tiles stayed blank. Here we
 * WAIT for each month, so one deliberate run fills the store and every later
 * page load is arithmetic over stored numbers.
 *
 * Deliberately slow and deliberately manual. PayProp clamps every page to 25
 * rows, so a month across both agencies is ~1,400 rows / ~56 sequential
 * requests; a year is roughly 700. Run it once, then leave it alone — a closed
 * month never needs computing twice.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = userId ? await findById(userId) : null;
  if (!admin || !isAdminEmail(admin.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const from = fromParam && MONTH_RE.test(fromParam) ? fromParam : `${currentMonth().slice(0, 4)}-01`;
  const to = toParam && MONTH_RE.test(toParam) ? toParam : currentMonth();
  if (from < MONEY_FLOOR) {
    return NextResponse.json(
      { error: `from must be ${MONEY_FLOOR} or later — PayProp holds nothing useful before that.` },
      { status: 400 }
    );
  }

  const started = Date.now();
  const hist = await getGciHistory(from, to, { wait: true }).catch((e) => {
    throw e;
  });

  const months = Object.keys(hist).sort();
  return NextResponse.json({
    from,
    to,
    elapsedMs: Date.now() - started,
    stored: months.length,
    // Named so a partial run is obvious. A month missing here is one PayProp
    // wouldn't answer for — not a month that earned nothing.
    missing: monthList(from, to).filter((m) => !hist[m]),
    months: months.map((m) => ({
      month: m,
      net: Math.round(hist[m].combinedGciNet),
      gross: Math.round(hist[m].combinedGciGross),
      payments: hist[m].paymentCount,
      unreachable: hist[m].unreachable,
    })),
  });
}

function monthList(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 1));
  while (cursor.toISOString().slice(0, 7) <= to) {
    out.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}
