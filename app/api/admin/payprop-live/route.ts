import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { isAdminEmail } from "@/lib/brand";
import { payPropConfigured } from "@/lib/payprop";
import {
  getAgencyIncome,
  getYtdIncome,
  getArrears,
  getMoveIns,
  payPropRefreshing,
} from "@/lib/payprop-income";
import { getPortfolioBook, portfolioError } from "@/lib/payprop-portfolio";
import { currentMonth } from "@/lib/format";

// Live PayProp money for the admin centre — the figures that used to come off
// the 11 Jul 2026 snapshot.
//
// GET /api/admin/payprop-live?month=YYYY-MM → { income, arrears }
//
// Both halves are best-effort: if PayProp is unreachable the field comes back
// null and the tab falls back to the snapshot rather than showing nothing.
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!payPropConfigured()) {
    return NextResponse.json({ connected: false, income: null, arrears: null });
  }

  const month = req.nextUrl.searchParams.get("month") ?? currentMonth();
  // Never blocks: returns what's cached and kicks off a refresh if it's stale.
  const income = getAgencyIncome(month);
  // The finals block shows the month just gone, and the admin home carries
  // year-to-date. Both are the same walk over a different date range.
  const [y, m] = month.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  // All five read their durable cache first, so they settle together in a few
  // milliseconds on a warm database rather than one after another.
  const [prevIncome, ytd, arrears, moveIns, portfolio] = await Promise.all([
    getAgencyIncome(prev),
    getYtdIncome(month),
    getArrears(),
    getMoveIns(month),
    getPortfolioBook(),
  ]);

  return NextResponse.json({
    connected: true,
    month,
    income,
    prevMonth: prev,
    prevIncome,
    ytd,
    arrears,
    moveIns,
    portfolio,
    portfolioError: portfolioError(),
    refreshing: payPropRefreshing(),
  });
}
