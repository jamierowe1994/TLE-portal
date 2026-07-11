import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { SEED } from "@/lib/seed-data";

// Assembled business-overview payload for the admin dashboard. The overview
// tab reads SEED directly (allowed per spec) — this endpoint exists so other
// clients (or a future live-merge step) can fetch the same shape server-side.
// Everything here is snapshot-sourced; the ?month= param is echoed back for
// context but the snapshot itself is the 11 Jul 2026 capture.

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const user = await findById(userId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!isAdminEmail(user.email)) {
    return NextResponse.json(
      { error: "This area is locked to the business owner." },
      { status: 403 }
    );
  }

  const month = req.nextUrl.searchParams.get("month") ?? "2026-07";

  // Jan–Jun actual GCI series reconstructed from the income table.
  const gciRow = SEED.income.monthlyTable.find(
    (r) => r.metric === "Combined GCI (exc VAT)"
  );
  const gciByMonth = {
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    actual: gciRow
      ? [gciRow.jan, gciRow.feb, gciRow.mar, gciRow.apr, gciRow.may, gciRow.jun]
      : [],
    budget: null, // 2026 budget series not captured from the source dashboard
    budgetNote:
      "2026 budget series was not captured from the Base44 dashboard — actual GCI only.",
  };

  return NextResponse.json({
    month,
    headline: SEED.headline,
    headcount: SEED.headcount,
    partnerRamp: SEED.partnerRamp,
    funnel: SEED.businessFunnel,
    conversions: SEED.conversions,
    masByPartnerType: SEED.masByPartnerType,
    yoyGrowth: SEED.yoyGrowth,
    gciByMonth,
    sources: SEED.sources,
  });
}
