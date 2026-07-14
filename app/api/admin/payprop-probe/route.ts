import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { payPropConfigured, payPropGet, payPropPing } from "@/lib/payprop";

// Admin-only diagnostic for wiring PayProp up. The published spec $refs an
// api_definitions.yaml we don't have, so rather than guessing field names this
// reports the connection plus the KEYS of a real row from each endpoint we care
// about — enough to map managed / rent roll / arrears against reality.
//
// GET /api/admin/payprop-probe   → { ping, properties, invoiceInstructions, tenantBalances }
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
      hint: "Add PAYPROP_API_KEY (and optionally PAYPROP_API_BASE) in Railway, then redeploy.",
    });
  }

  const ping = await payPropPing();

  // One row from each endpoint — keys tell us the shape, the sample tells us the
  // semantics (e.g. whether monthly_payment is the estimate or the real rent).
  const sample = async (path: string, params: Record<string, string | number> = {}) => {
    const res = await payPropGet(path, { rows: 1, page: 1, ...params });
    if (!res) return { ok: false as const, error: "call failed or not permitted" };
    const first = res.items[0] as Record<string, unknown> | undefined;
    return {
      ok: true as const,
      totalRows: res.pagination?.total_rows ?? null,
      keys: first ? Object.keys(first) : [],
      first: first ?? null,
    };
  };

  const [properties, invoiceInstructions, tenantBalances] = await Promise.all([
    sample("export/properties", { include_active_tenancies: "true", include_commission: "true" }),
    sample("export/invoice-instructions"),
    sample("report/tenant/balances"),
  ]);

  return NextResponse.json({
    configured: true,
    ping,
    properties,
    invoiceInstructions,
    tenantBalances,
  });
}
