import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import {
  payPropAccounts,
  payPropAuthMode,
  payPropConfigured,
  payPropGet,
  payPropGetAll,
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
      hint:
        "Add credentials in Railway, then redeploy. OAuth: PAYPROP_CLIENT_ID + " +
        "PAYPROP_CLIENT_SECRET (or the _SCOTLAND / _UK variants). Legacy: " +
        "PAYPROP_API_KEY_SCOTLAND / PAYPROP_API_KEY_UK.",
    });
  }

  const ping = await payPropPing();
  const { connectedPayPropAccounts } = await import("@/lib/payprop-tokens");
  const connected = await connectedPayPropAccounts();
  const seededFromEnv = Boolean(
    process.env.PAYPROP_REFRESH_TOKEN ??
      process.env.PAYPROP_REFRESH_TOKEN_UK ??
      process.env.PAYPROP_REFRESH_TOKEN_SCOTLAND
  );
  // Which scheme each account resolved to — the first thing to check when a
  // migrated account starts failing.
  const auth = Object.fromEntries(
    payPropAccounts().map((a) => [a, payPropAuthMode(a)])
  );

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

  // Who PayProp thinks manages each property. Needed to attribute portfolio,
  // arrears and move-ins per partner — reported here so the matching rule is
  // built against the real values rather than assumed.
  const agents: Record<string, { properties: number; ids: string[]; accounts: string[] }> = {};
  for (const id of payPropAccounts()) {
    const rows = await payPropGetAll<{
      responsible_agent?: unknown;
      responsible_agent_id?: unknown;
      responsible_user?: unknown;
    }>(id, "export/properties", { is_archived: "false" }).catch(() => []);
    for (const r of rows) {
      const name =
        typeof r.responsible_agent === "string"
          ? r.responsible_agent
          : JSON.stringify(r.responsible_agent ?? null);
      const key = name || "(none)";
      const entry = (agents[key] ??= { properties: 0, ids: [], accounts: [] });
      entry.properties++;
      const aid = String(r.responsible_agent_id ?? "");
      if (aid && !entry.ids.includes(aid)) entry.ids.push(aid);
      if (!entry.accounts.includes(id)) entry.accounts.push(id);
    }
  }

  return NextResponse.json({
    configured: true,
    auth,
    connected,
    seededFromEnv,
    ping,
    agents,
    accounts,
  });
}
