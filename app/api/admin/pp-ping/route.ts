import { NextRequest, NextResponse } from "next/server";
import { payPropPing, payPropAccounts, payPropLabel } from "@/lib/payprop";
import { getAgencyIncome } from "@/lib/payprop-income";
import { exVat } from "@/lib/format";

// TEMPORARY, READ-ONLY: confirms each PayProp account's live connection in
// PRODUCTION and re-totals a month's agency fees per account, so the portal's
// figure can be checked against the accounts summary. Keyed rather than
// session-gated so it can be driven from a terminal. Delete after use.
export const dynamic = "force-dynamic";
const KEY = "4bbf0e631303fac3101f6e007572fdd6c0d8e57c";

interface Row {
  amount?: number | string;
  beneficiary?: { type?: string };
  payment_batch?: { transfer_date?: string };
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("k") !== KEY) {
    return NextResponse.json({ error: "no" }, { status: 404 });
  }
  const month = req.nextUrl.searchParams.get("m") ?? "2026-07";
  const ping = await payPropPing();
  const out: Record<string, unknown> = { month, ping, fees: {} };

  // The PORTAL's own figure, not a hand-rolled filter: combinedGci is agency
  // slice + partner fees, which is what Susan's "Total" column is. An
  // agency-only filter matches Glasgow (zero associate payments every month)
  // and badly under-counts E&W (27k to associates in July) — the exact trap
  // this probe fell into first time.
  const income = await getAgencyIncome(month);
  let combinedNet = 0;
  if (income) {
    for (const a of income.byAccount) {
      const gross = +a.combinedGci.toFixed(2);
      const net = +exVat(gross).toFixed(2);
      combinedNet += net;
      (out.fees as Record<string, unknown>)[a.label] = {
        gross,
        net,
        agencyOnlyNet: +exVat(a.agencyIncome).toFixed(2),
      };
    }
    out.portalCombinedGciGross = +income.combinedGci.toFixed(2);
    out.paidToBeneficiaries = +income.paidToBeneficiaries.toFixed(2);
    out.unclassified = income.unclassifiedByCategory.slice(0, 6);
  }
  out.combinedNet = +combinedNet.toFixed(2);
  out.susanSaid = 51068.37;
  return NextResponse.json(out);
}
