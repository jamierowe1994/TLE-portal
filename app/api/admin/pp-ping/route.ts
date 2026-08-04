import { NextRequest, NextResponse } from "next/server";
import { payPropPing, payPropGetAll, payPropAccounts, payPropLabel } from "@/lib/payprop";
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

  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const num = (v: unknown) => {
    const n = parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n : 0;
  };

  let combinedNet = 0;
  for (const acc of payPropAccounts()) {
    const label = payPropLabel(acc);
    if (!ping.find((p) => p.account === acc)?.ok) {
      (out.fees as Record<string, unknown>)[label] = "not authenticated";
      continue;
    }
    const rows = await payPropGetAll<Row>(acc, "report/all-payments", {
      from_date: from,
      to_date: to,
    }).catch(() => null);
    if (!rows) {
      (out.fees as Record<string, unknown>)[label] = "fetch failed";
      continue;
    }
    const fee = rows.filter(
      (r) =>
        r.beneficiary?.type === "agency" &&
        (r.payment_batch?.transfer_date ?? "").slice(0, 7) === month
    );
    const gross = +fee.reduce((t, r) => t + num(r.amount), 0).toFixed(2);
    const net = +exVat(gross).toFixed(2);
    combinedNet += net;
    (out.fees as Record<string, unknown>)[label] = { gross, net, rows: fee.length };
  }
  out.combinedNet = +combinedNet.toFixed(2);
  out.susanSaid = 51068.37;
  return NextResponse.json(out);
}
