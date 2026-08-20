import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { SEED, PERIOD_KPIS } from "@/lib/seed-data";
import { getGciSeries } from "@/lib/gci-history";
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
  /*
   * Monthly GCI, live from the per-month store — the chart GROWS as months
   * close rather than being a fixed Jan–Jun literal reading one seed row.
   *
   * Falls back to the seed only when the store has nothing yet (a cold
   * environment mid-backfill), so the chart is never blank.
   */
  const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const series = await getGciSeries(month).catch(() => null);
  const live = series?.months ?? [];
  const gciByMonth = live.length
    ? {
        labels: live.map((m) => SHORT[Number(m.month.slice(5, 7)) - 1]),
        // NET of VAT — PayProp's amounts are VAT-inclusive and the accounts
        // sheet is not. Charting the gross figure would overstate every bar
        // by 20%.
        actual: live.map((m) => Math.round(m.combinedGciNet)),
        // What each bar is MADE OF. A total invites "made up of what?", and
        // until now the only way to find out was to ask someone.
        detail: live.map((m) => {
          const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
          return [
            ["Combined GCI", gbp(m.combinedGciNet)] as [string, string],
            ...m.byAccount.map(
              (a) => [a.label, gbp(a.combinedGci)] as [string, string]
            ),
            ["TLE kept", gbp(m.agencyIncomeNet)] as [string, string],
            ["Partners", gbp(m.combinedGciNet - m.agencyIncomeNet)] as [string, string],
            ["VAT taken off", gbp(m.vat)] as [string, string],
            ["Partners earning", String(m.agentsEarning)] as [string, string],
            ["Payments", String(m.paymentCount)] as [string, string],
          ];
        }),
        budget: null,
        budgetNote:
          series && !series.complete
            ? `Live from PayProp, net of VAT — ${
                series.missing.length ? `${series.missing.length} month(s) still computing. ` : ""
              }${
                series.unreachable.length
                  ? `${series.unreachable.join(", ")} unreachable, so these bars are SHORT by a whole agency.`
                  : ""
              }`.trim()
            : "Live from PayProp, net of VAT. No budget series exists in the source data — actual GCI only.",
        live: true,
        ytdNet: series?.ytdNet ?? null,
        ytdGross: series?.ytdGross ?? null,
        complete: series?.complete ?? false,
        unreachable: series?.unreachable ?? [],
      }
    : {
        labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
        actual: gciRow
          ? [gciRow.jan, gciRow.feb, gciRow.mar, gciRow.apr, gciRow.may, gciRow.jun]
          : [],
        budget: null,
        budgetNote:
          "Still gathering the live monthly commission from PayProp — showing the captured 2026 actuals meanwhile.",
        live: false,
        ytdNet: null,
        ytdGross: null,
        complete: false,
        unreachable: [],
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
