import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { getGciHistory } from "@/lib/gci-history";
import { currentMonth } from "@/lib/format";

/**
 * Rent collection, month by month.
 *
 * GET /api/admin/rent-collection?month=YYYY-MM  → the twelve months ending there
 *
 * This is the Arrears tab's month-scoped figure, and it is deliberately NOT
 * arrears. A rebuilt arrears list was measured against PayProp's own balances
 * and rejected: on a closed month it agreed on 2 of 9 real cases, invented 1,
 * and missed 7; mid-month it produced 44 false positives out of 50. Arrears is
 * the one figure on this dashboard whose failure has a cost outside the
 * building, so it stays a current-state read.
 *
 * What IS honest is the flow: how much rent came in, from how many properties,
 * from how many tenants. Every one of those is counted from payment rows that
 * exist. Nothing is inferred and no individual can be wrongly named.
 *
 * Served from the stored monthly figures, so this is arithmetic rather than a
 * walk of PayProp.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthsBack(to: string, count: number): string {
  const [y, m] = to.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - (count - 1), 1));
  return d.toISOString().slice(0, 7);
}

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = userId ? await findById(userId) : null;
  if (!admin || !isAdminEmail(admin.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const param = req.nextUrl.searchParams.get("month");
  const to = param && MONTH_RE.test(param) ? param : currentMonth();
  const from = monthsBack(to, 12);

  const hist = await getGciHistory(from, to).catch(
    () => ({}) as Awaited<ReturnType<typeof getGciHistory>>
  );
  const months = Object.keys(hist)
    .sort()
    .map((m) => ({
      month: m,
      rentCollected: Math.round(hist[m].rentCollected),
      propertiesPaying: hist[m].propertiesPaying,
      tenantsPaying: hist[m].tenantsPaying,
      // Mean rent per paying property — a stable shape that makes an odd month
      // obvious without needing a denominator we cannot honestly supply.
      avgPerProperty:
        hist[m].propertiesPaying > 0
          ? Math.round(hist[m].rentCollected / hist[m].propertiesPaying)
          : null,
      /** Short by a whole agency — the figures below understate. */
      incomplete: hist[m].unreachable.length > 0,
    }));

  return NextResponse.json({
    from,
    to,
    months,
    /** Months in the window with no stored figures yet. */
    missing: months.length === 0,
  });
}
