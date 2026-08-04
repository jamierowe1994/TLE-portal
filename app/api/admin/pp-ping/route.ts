import { NextRequest, NextResponse } from "next/server";
import { payPropPing, payPropGetAll, payPropAccounts, payPropLabel } from "@/lib/payprop";
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
  // WHY the gap: split every category by BENEFICIARY TYPE. The classifier
  // currently tests the category allowlist BEFORE the type, so a fee sitting
  // in PayProp's "Other" category is discarded — and Susan's sheet has an
  // "Other Fees" column that is real income.
  const [yy, mm] = month.split("-").map(Number);
  const wFrom = new Date(Date.UTC(yy, mm - 2, 1)).toISOString().slice(0, 10);
  const wTo = new Date(Date.UTC(yy, mm + 1, 0)).toISOString().slice(0, 10);
  const split: Record<string, Record<string, Record<string, number>>> = {};
  for (const acc of payPropAccounts()) {
    if (!ping.find((p) => p.account === acc)?.ok) continue;
    const raw = await payPropGetAll<{
      amount?: number | string;
      category?: { name?: string };
      beneficiary?: { type?: string };
      payment_batch?: { transfer_date?: string };
    }>(acc, "report/all-payments", { from_date: wFrom, to_date: wTo }).catch(() => []);
    const label = payPropLabel(acc);
    split[label] = {};
    for (const r of raw) {
      if ((r.payment_batch?.transfer_date ?? "").slice(0, 7) !== month) continue;
      const c = r.category?.name || "Other";
      const t = r.beneficiary?.type || "(none)";
      split[label][c] ??= {};
      split[label][c][t] = +(((split[label][c][t] ?? 0) + num(r.amount)).toFixed(2));
    }
  }
  out.categoryByBeneficiaryType = split;

  out.combinedNet = +combinedNet.toFixed(2);
  out.susanSaid = 51068.37;
  return NextResponse.json(out);
}
