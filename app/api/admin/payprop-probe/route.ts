import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import {
  payPropAccounts,
  payPropConfigured,
  payPropGet,
  payPropLabel,
  payPropPing,
  type PayPropAccountId,
} from "@/lib/payprop";

// Admin-only diagnostic for wiring PayProp up. The published spec $refs an
// api_definitions.yaml we don't have, so rather than guessing field names this
// reports the connection plus the KEYS of a real row from each endpoint we care
// about — per account, since Scotland and the rest of the UK are separate
// agencies and every business-wide figure is the sum of the two.
//
// GET /api/admin/payprop-probe → { ping, accounts: { scotland: {...}, uk: {...} } }
export async function GET(req: NextRequest) {
  const adminId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = adminId ? await findById(adminId) : null;
  if (!admin) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!isAdminEmail(admin.email)) {
    return NextResponse.json(
      { error: "This area is locked to the business owner." },
      { status: 403 }
    );
  }
  if (!payPropConfigured()) {
    return NextResponse.json({
      configured: false,
      hint: "Add PAYPROP_API_KEY_SCOTLAND and/or PAYPROP_API_KEY_UK in Railway, then redeploy.",
    });
  }

  const ping = await payPropPing();

  const sample = async (
    account: PayPropAccountId,
    path: string,
    params: Record<string, string | number> = {}
  ) => {
    const res = await payPropGet(account, path, { rows: 1, page: 1, ...params });
    if (!res) return { ok: false as const, error: "call failed or not permitted" };
    const first = res.items[0] as Record<string, unknown> | undefined;
    return {
      ok: true as const,
      totalRows: res.pagination?.total_rows ?? null,
      keys: first ? Object.keys(first) : [],
    };
  };

  const ids = payPropAccounts();
  const accounts: Record<string, unknown> = {};
  await Promise.all(
    ids.map(async (id) => {
      const [active, archived, invoices, balances] = await Promise.all([
        // is_archived defaults to false — spelled out so the intent is obvious.
        sample(id, "export/properties", {
          is_archived: "false",
          include_active_tenancies: "true",
          include_commission: "true",
          include_contract_amount: "true",
        }),
        sample(id, "export/properties", { is_archived: "true" }),
        sample(id, "export/invoice-instructions"),
        sample(id, "report/tenant/balances"),
      ]);
      accounts[id] = {
        label: payPropLabel(id),
        activeProperties: active,
        archivedProperties: archived,
        invoiceInstructions: invoices,
        tenantBalances: balances,
      };
    })
  );

  return NextResponse.json({ configured: true, ping, accounts });
}
