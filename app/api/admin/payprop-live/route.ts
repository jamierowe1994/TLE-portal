import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { isAdminEmail } from "@/lib/brand";
import { payPropConfigured } from "@/lib/payprop";
import { getAgencyIncome, getArrears, payPropRefreshing } from "@/lib/payprop-income";
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
  const arrears = getArrears();

  return NextResponse.json({
    connected: true,
    month,
    income,
    arrears,
    refreshing: payPropRefreshing(),
  });
}
