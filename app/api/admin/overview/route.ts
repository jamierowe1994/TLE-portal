import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { SEED, PERIOD_KPIS } from "@/lib/seed-data";
import { getOverrides } from "@/lib/actuals-store";
import { resolveStat } from "@/lib/stats";
import type { StatValue } from "@/lib/types";

// Assembled business-overview payload for the admin Overview tab. Snapshot
// figures are merged with admin manual overrides (actuals-store) through the
// live → manual → snapshot resolveStat chain, so a figure keyed in on another
// tab (e.g. funnel.moveIns on Move-ins) shows here with its MANUAL badge too.
// The ?month= param picks which month's overrides apply; the snapshot itself
// is the 11 Jul 2026 capture.

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

  // Merge admin manual overrides into the sales funnel (manual beats snapshot).
  const overrides = await getOverrides(month);
  const manualFor = (metric: string) => {
    const o = overrides.find(
      (row) => row.scope === "business" && row.metric === metric
    );
    return o ? { value: o.value, note: o.note } : null;
  };
  const mergeFunnel = (
    stat: StatValue | undefined,
    metric: string
  ): StatValue => resolveStat(null, manualFor(metric), stat ?? null);

  const seedFunnel = SEED.businessFunnel;
  const funnel = {
    ...seedFunnel,
    marketAppraisals: mergeFunnel(seedFunnel.marketAppraisals, "funnel.marketAppraisals"),
    listings: mergeFunnel(seedFunnel.listings, "funnel.listings"),
    viewings: mergeFunnel(seedFunnel.viewings, "funnel.viewings"),
    applications: mergeFunnel(seedFunnel.applications, "funnel.applications"),
    moveIns: mergeFunnel(seedFunnel.moveIns, "funnel.moveIns"),
    pipeline: mergeFunnel(seedFunnel.pipeline, "funnel.pipeline"),
    liveListings: mergeFunnel(seedFunnel.liveListings, "funnel.liveListings"),
    gci: mergeFunnel(seedFunnel.gci, "funnel.gci"),
  };

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
    funnel,
    conversions: SEED.conversions,
    masByPartnerType: SEED.masByPartnerType,
    yoyGrowth: SEED.yoyGrowth,
    gciByMonth,
    sources: SEED.sources,
    // Every period Susan's dashboard can show, captured 21 Jul 2026 — powers
    // the working period pills on the mirrored Overview.
    periods: PERIOD_KPIS,
  });
}
