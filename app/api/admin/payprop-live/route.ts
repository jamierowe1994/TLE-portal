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
  exVat,
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
  // The finals block shows the month just gone, and the admin home carries
  // year-to-date. Both are the same walk over a different date range.
  const [y, m] = month.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  // None of these block on a walk: each returns what's cached and kicks off a
  // refresh if it's stale. All six read their durable cache first, so they
  // settle together in a few milliseconds on a warm database rather than one
  // after another.
  //
  // `income` belongs IN here. Left outside and unawaited it serialised as {},
  // which the Income tab reads as a live answer — green banner, then a throw on
  // the first field it touches.
  const [income, prevIncome, ytd, arrears, moveIns, portfolio] = await Promise.all([
    getAgencyIncome(month),
    getAgencyIncome(prev),
    getYtdIncome(month),
    getArrears(),
    getMoveIns(month),
    getPortfolioBook(),
  ]);

  // Report the FEE figures net of VAT.
  //
  // PayProp's amounts are VAT-inclusive; the business is not. The Income tab's
  // own metric is literally labelled "Combined GCI (exc VAT)", so the inclusive
  // figure was being rendered under a heading promising the opposite — and the
  // accounts sheet confirms the convention (June: gross 41,438.44, VAT
  // 6,906.49, net 34,531.95).
  //
  // Converted here, once, rather than at fifteen call sites where one missed
  // conversion would put a 20% error on screen under a correct-looking label.
  // ownerPayments and unclassified are deliberately left alone: rent passed to
  // a landlord is not a VAT-able fee, and unclassified mixes contractor costs
  // with deposit movements.
  const ex = exVat;
  const netted = <T extends typeof income>(i: T): T =>
    i == null
      ? i
      : ({
          ...i,
          agencyIncome: i.net.agencyIncome,
          combinedGci: i.net.combinedGci,
          paidToBeneficiaries: i.net.paidToBeneficiaries,
          byCategory: i.byCategory.map((c) => ({ ...c, amount: ex(c.amount) })),
          byPartner: i.byPartner.map((p) => ({ ...p, amount: ex(p.amount) })),
          byAccount: i.byAccount.map((a) => ({
            ...a,
            agencyIncome: ex(a.agencyIncome),
            combinedGci: ex(a.combinedGci),
          })),
          /** The VAT-inclusive originals, so a figure can be traced to PayProp. */
          gross: {
            agencyIncome: i.agencyIncome,
            combinedGci: i.combinedGci,
            paidToBeneficiaries: i.paidToBeneficiaries,
            vat: i.net.vat,
          },
        } as T);

  return NextResponse.json({
    /**
     * Per agent for THIS month, attributed by property (see
     * AgencyIncome.byAgentProperty). These SUM to the headline commission
     * because they are the same rows split, which is what makes the Agents
     * page a reconciliation check rather than a second opinion.
     */
    byAgent: income?.byAgentProperty ?? [],
    // Which agencies PayProp wouldn't let us read. The Overview needs this to
    // say a total is INCOMPLETE rather than presenting one agency's money as
    // the whole business — E&W's OAuth refresh token is currently rejected,
    // and without this its absence looks like a smaller but plausible GCI.
    unreachable: income?.unreachable ?? ytd?.unreachable ?? [],
    connected: true,
    month,
    income: netted(income),
    prevMonth: prev,
    prevIncome: netted(prevIncome),
    ytd: netted(ytd),
    arrears,
    moveIns,
    portfolio,
    portfolioError: portfolioError(),
    refreshing: payPropRefreshing(),
  });
}
