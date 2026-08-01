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

  // Page size is the single biggest lever on how long a walk takes. The code
  // has long assumed PayProp clamps `rows` to 25, but the spec sets no
  // maximum — so ask for more and count what actually comes back.
  const pageSize: Record<string, number> = {};
  for (const size of [25, 50, 100, 200]) {
    const r = await payPropGet(payPropAccounts()[0], "export/properties", {
      is_archived: "false",
      rows: size,
      page: 1,
    }).catch(() => null);
    pageSize[`asked_${size}`] = r?.items.length ?? 0;
  }

  // The question the applications work is blocked on: does a payment row carry
  // a PROPERTY or TENANCY, so a holding fee, deposit or first rent can be tied
  // to a specific deal? We only ever declared amount/category/beneficiary/
  // due_date/description on PaymentRow, which is not evidence the rest isn't
  // there — it just means nothing has ever looked.
  //
  // Reported as keys plus a type map, because a key alone doesn't say whether
  // `property` is an id, a name or a nested object. Full values only behind
  // ?values=1, since these rows carry tenant names and real amounts.
  // Recurses, because "object{ id, name }" told us a property key EXISTS but
  // not whether it holds anything — and a join against a null is still a null.
  // Depth 3 reaches incoming_transaction.bank_statement.date, which is the
  // deepest thing here worth seeing.
  const shapeOf = (
    row: Record<string, unknown>,
    depth = 0
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v === null) out[k] = "null";
      else if (Array.isArray(v)) out[k] = `array[${v.length}]`;
      else if (typeof v === "object") {
        out[k] =
          depth >= 3
            ? `object{ ${Object.keys(v as object).join(", ")} }`
            : shapeOf(v as Record<string, unknown>, depth + 1);
      } else out[k] = `${typeof v}: ${String(v).slice(0, 40)}`;
    }
    return out;
  };

  // Where a key lives, at any depth — the first run of this probe reported
  // "no property link" because it only looked at top level, while `property`,
  // `tenant` and `deposit_id` were all sitting inside `incoming_transaction`.
  const findPaths = (row: unknown, test: RegExp, trail = ""): string[] => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const hits: string[] = [];
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      const path = trail ? `${trail}.${k}` : k;
      if (test.test(k)) hits.push(path);
      hits.push(...findPaths(v, test, path));
    }
    return hits;
  };

  const showValues = req.nextUrl.searchParams.get("values") === "1";
  // Default to the last 30 days, not month-to-date: run on the 1st, a
  // month-to-date range is a single day and comes back empty, which reads as
  // "PayProp has nothing" rather than "you asked for one day".
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const from =
    req.nextUrl.searchParams.get("from") ??
    iso(new Date(today.getTime() - 30 * 86_400_000));
  const to = req.nextUrl.searchParams.get("to") ?? iso(today);

  const payments: Record<string, unknown> = { range: { from, to } };
  for (const id of payPropAccounts()) {
    const res = await payPropGet(id, "report/all-payments", {
      from_date: from,
      to_date: to,
      rows: 25, // the confirmed page cap — a fuller sample costs the same call
      page: 1,
    }).catch((e: unknown) => {
      return { error: e instanceof Error ? e.message : String(e) } as never;
    });
    if (!res || !("items" in res)) {
      payments[id] = { ok: false, error: "call failed or not permitted" };
      continue;
    }
    const rows = res.items as Array<Record<string, unknown>>;
    // Don't shape rows[0] blindly. The first two runs both returned a leading
    // row with an empty id, a 0.00 amount and null category/beneficiary —
    // identical across both accounts AND two different date ranges, which is
    // not what real payments look like. Shape the first row that actually
    // carries an id instead, and report how many were blank so the pattern is
    // visible rather than silently skipped.
    const populated = rows.filter((r) => String(r.id ?? "").trim() !== "");
    const first = populated[0] ?? rows[0];
    payments[id] = {
      ok: true,
      label: payPropLabel(id),
      totalRows: res.pagination?.total_rows ?? null,
      returned: rows.length,
      blankRows: rows.length - populated.length,
      shapedFrom: populated[0] ? "a row with an id" : "rows[0] — none had an id",
      keys: first ? Object.keys(first) : [],
      shape: first ? shapeOf(first) : null,
      // The actual answer, spelled out so it doesn't need eyeballing. Searched
      // at every depth, and reported as the PATH rather than a bare boolean —
      // knowing it is `incoming_transaction.property` and not `property` is the
      // difference between a working join and a null.
      propertyPaths: first ? findPaths(first, /propert/i) : null,
      tenantPaths: first ? findPaths(first, /tenan/i) : null,
      depositPaths: first ? findPaths(first, /deposit/i) : null,
      datePaths: first ? findPaths(first, /date|reconcil/i) : null,
      ...(showValues ? { rawRows: rows } : {}),
    };
  }

  // One sample row proves the shape. It does NOT tell us which payment TYPES
  // exist, and that is what decides whether a holding fee can be told apart
  // from a deposit from first rent automatically, or whether we are stuck
  // pattern-matching the description string. So: census a capped walk.
  //
  // Capped at 8 pages (200 rows) per account rather than the full ~1,078. The
  // queue paces at 2.5 req/s, so a full walk would hold an admin request open
  // for ~40s and shove every partner's dashboard behind it.
  const CENSUS_PAGES = 8;
  const census: Record<string, unknown> = {};
  for (const id of payPropAccounts()) {
    const categories = new Map<string, { rows: number; total: number }>();
    const txTypes = new Map<string, number>();
    const batchStatuses = new Map<string, number>();
    let rows = 0;
    let blank = 0;
    let withProperty = 0;
    let withTenant = 0;
    let withDeposit = 0;

    for (let page = 1; page <= CENSUS_PAGES; page++) {
      const res = await payPropGet(id, "report/all-payments", {
        from_date: from,
        to_date: to,
        rows: 25,
        page,
      }).catch(() => null);
      if (!res || res.items.length === 0) break;
      for (const raw of res.items as Array<Record<string, unknown>>) {
        rows++;
        if (String(raw.id ?? "").trim() === "") {
          blank++;
          continue;
        }
        const cat = (raw.category as { name?: string } | null)?.name ?? "(none)";
        const entry = categories.get(cat) ?? { rows: 0, total: 0 };
        entry.rows++;
        entry.total += Number(raw.amount ?? 0) || 0;
        categories.set(cat, entry);

        const it = raw.incoming_transaction as Record<string, unknown> | null;
        if (it) {
          const t = String(it.type ?? "(none)");
          txTypes.set(t, (txTypes.get(t) ?? 0) + 1);
          if ((it.property as { id?: string } | null)?.id) withProperty++;
          if ((it.tenant as { id?: string } | null)?.id) withTenant++;
          if (String(it.deposit_id ?? "").trim() !== "") withDeposit++;
        }
        const b = raw.payment_batch as { status?: string } | null;
        const bs = String(b?.status ?? "(none)");
        batchStatuses.set(bs, (batchStatuses.get(bs) ?? 0) + 1);
      }
      if (res.items.length < 25) break;
    }

    const real = rows - blank;
    const pct = (n: number) => (real ? `${Math.round((n / real) * 100)}%` : "—");
    census[id] = {
      label: payPropLabel(id),
      sampled: rows,
      blank,
      // The join question, answered as a rate rather than a single example —
      // one populated row proves nothing about the other thousand.
      propertyPopulated: `${withProperty}/${real} (${pct(withProperty)})`,
      tenantPopulated: `${withTenant}/${real} (${pct(withTenant)})`,
      depositIdPresent: `${withDeposit}/${real} (${pct(withDeposit)})`,
      categories: Object.fromEntries(
        [...categories.entries()]
          .sort((a, b) => b[1].rows - a[1].rows)
          .map(([k, v]) => [k, { rows: v.rows, total: v.total.toFixed(2) }])
      ),
      transactionTypes: Object.fromEntries(txTypes),
      batchStatuses: Object.fromEntries(batchStatuses),
    };
  }

  return NextResponse.json({
    configured: true,
    pageSize,
    auth,
    connected,
    seededFromEnv,
    ping,
    agents,
    accounts,
    payments,
    census,
  });
}
