import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import {
  payPropAccounts,
  payPropGetAll,
  payPropLabel,
  payPropConfigured,
} from "@/lib/payprop";
import { agentBeneficiaryIds } from "@/lib/payprop-income";
import { getAgentBook } from "@/lib/payprop-portfolio";

// Reconcile ONE partner's month against the sheet, line by line.
//
// Rhiannon's June reads £4,173 in the portal and £3,007 on Susan's sheet;
// May reads £2,000 against £2,429. The directions disagree, so it is not one
// scale factor — and a total on its own cannot say why. This lists every row
// the portal counted, with all four dates PayProp carries and the two fields
// the production code ignores entirely:
//
//   secondary_payment.is_parent / is_child — if PayProp returns a parent row
//     AND its children, and both carry the partner as beneficiary, the money
//     is counted twice. That would overstate, like June.
//   part_of_amount — a partial settlement. Counting `amount` when only part
//     moved would also overstate.
//
// And it totals the SAME rows three ways — by due date, by reconciliation
// date, by batch transfer date. If the sheet is built on when money moved and
// the portal on when it fell due, a fee due 31 May and settled 1 June lands in
// a different month for each, which produces disagreements in BOTH directions.
// That single cause would explain both months.
//
// GET /api/admin/agent-earnings-audit?name=Rhiannon+Dodge&month=2026-06
//     &email=...      optional, tried before the name (as the real code does)
//     &rows=1         include the per-row detail, not just the totals

interface RawRow {
  id?: string;
  amount?: string;
  part_of_amount?: string;
  category?: { name?: string };
  beneficiary?: { id?: string; name?: string; type?: string };
  due_date?: string;
  description?: string;
  secondary_payment?: {
    is_child?: boolean;
    is_parent?: boolean;
    parent_payment_id?: string | null;
  };
  payment_batch?: { status?: string; transfer_date?: string };
  incoming_transaction?: {
    reconciliation_date?: string;
    property?: { id?: string; name?: string };
  };
}

const money = (v: unknown) => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

// Kept in step with FEE_CATEGORIES in lib/payprop-income.ts. Duplicated on
// purpose: if the two ever drift, this audit reports a different total from
// the dashboard and that discrepancy is itself the finding.
const FEE_CATEGORIES = new Set([
  "Management Fee",
  "Monthly Management Fee",
  "First Month Management Fee",
  "Set Up Fee",
  "Management Fee - Investor Services",
  "Rent and Legal Protection",
]);

export async function GET(req: NextRequest) {
  const adminId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = adminId ? await findById(adminId) : null;
  if (!admin) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!isAdminEmail(admin.email)) {
    return NextResponse.json(
      { error: "This area is locked to the business owner." },
      { status: 403 }
    );
  }
  if (!payPropConfigured()) {
    return NextResponse.json({ configured: false });
  }

  const q = req.nextUrl.searchParams;
  const month = q.get("month") ?? "";
  const name = q.get("name") ?? "";
  const email = q.get("email") ?? "";
  const withRows = q.get("rows") === "1";
  if (!/^\d{4}-\d{2}$/.test(month) || (!name && !email)) {
    return NextResponse.json(
      { error: "Need ?month=YYYY-MM and ?name= (or ?email=)" },
      { status: 400 }
    );
  }

  try {
    const { ids, matchedBy } = await agentBeneficiaryIds(email, name);
    if (ids.length === 0) {
      return NextResponse.json({
        month,
        name,
        matched: false,
        verdict:
          "PayProp holds no beneficiary under that email or name, so the portal " +
          "figure for this partner is a snapshot, not a live total.",
      });
    }
    const idSet = new Set(ids);

    // Widened by a month either side ON PURPOSE. The whole question is whether
    // a payment sits in a different month depending on which date you use, and
    // a query clamped to June can never show a June-due fee settled in July.
    const [y, m] = month.split("-").map(Number);
    const pad = (n: number) => String(n).padStart(2, "0");
    const from = `${m === 1 ? y - 1 : y}-${pad(m === 1 ? 12 : m - 1)}-01`;
    const lastOfNext = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 0));
    const to = lastOfNext.toISOString().slice(0, 10);

    // The audit asks "what was paid TO this partner". Susan's sheet may instead
    // ask "what did this partner's properties earn" — a different question that
    // can give a different number, because a fee on their property can be paid
    // to someone else entirely. Now that payments carry a property id we can
    // compute both and see which one the sheet is actually built on.
    const book = await getAgentBook(name).catch(() => null);
    const propertyIds = new Set(book?.propertyIds ?? []);

    const rows: Array<RawRow & { account: string }> = [];
    const byPropertyRows: Array<RawRow & { account: string }> = [];
    for (const acc of payPropAccounts()) {
      const got = await payPropGetAll<RawRow>(acc, "report/all-payments", {
        from_date: from,
        to_date: to,
      }).catch(() => []);
      for (const r of got) {
        const tagged = { ...r, account: payPropLabel(acc) };
        if (r.beneficiary?.id && idSet.has(r.beneficiary.id)) rows.push(tagged);
        const pid = r.incoming_transaction?.property?.id;
        if (pid && propertyIds.has(pid)) byPropertyRows.push(tagged);
      }
    }

    const inMonth = (d: string | undefined) => (d ?? "").slice(0, 7) === month;
    const feeRows = rows.filter((r) => FEE_CATEGORIES.has(r.category?.name ?? ""));

    const sum = (rs: typeof feeRows) => rs.reduce((t, r) => t + money(r.amount), 0);
    const round = (n: number) => Math.round(n * 100) / 100;

    const byDue = feeRows.filter((r) => inMonth(r.due_date));
    const byRecon = feeRows.filter((r) =>
      inMonth(r.incoming_transaction?.reconciliation_date)
    );
    const byTransfer = feeRows.filter((r) =>
      inMonth(r.payment_batch?.transfer_date)
    );

    const parents = byDue.filter((r) => r.secondary_payment?.is_parent);
    const children = byDue.filter((r) => r.secondary_payment?.is_child);
    const partial = byDue.filter((r) => money(r.part_of_amount) > 0);

    return NextResponse.json({
      month,
      name,
      matched: true,
      matchedBy,
      beneficiaryIds: ids,
      searchedRange: { from, to },
      feeRowsInRange: feeRows.length,

      // Attribution by PROPERTY rather than by who was paid. If the sheet is
      // built this way the totals here will match it and the beneficiary ones
      // will not — which is a different fix from a date basis.
      byPropertyAttribution: (() => {
        const feeByProp = byPropertyRows.filter((r) =>
          FEE_CATEGORIES.has(r.category?.name ?? "")
        );
        const due = feeByProp.filter((r) => inMonth(r.due_date));
        const recon = feeByProp.filter((r) =>
          inMonth(r.incoming_transaction?.reconciliation_date)
        );
        return {
          propertiesOnTheirBook: propertyIds.size,
          bookLoaded: book != null,
          totals: {
            byDueDate: round(sum(due)),
            byReconciliationDate: round(sum(recon)),
          },
          counts: { byDueDate: due.length, byReconciliationDate: recon.length },
          // Fees on their properties that went to somebody ELSE. If this is
          // large it explains a sheet reading higher than the portal.
          paidToOthers: round(
            sum(due.filter((r) => !(r.beneficiary?.id && idSet.has(r.beneficiary.id))))
          ),
        };
      })(),

      // The same rows, bucketed three ways. If these disagree, the month
      // boundary IS the discrepancy and no amount of category work will fix it.
      totals: {
        byDueDate: round(sum(byDue)),
        byReconciliationDate: round(sum(byRecon)),
        byBatchTransferDate: round(sum(byTransfer)),
      },
      counts: {
        byDueDate: byDue.length,
        byReconciliationDate: byRecon.length,
        byBatchTransferDate: byTransfer.length,
      },

      // What the portal ignores. Non-zero here means the dashboard total is
      // wrong by construction, not by date.
      doubleCountRisk: {
        parentRows: parents.length,
        childRows: children.length,
        parentAmount: round(sum(parents)),
        childAmount: round(sum(children)),
        note:
          "If both a parent row and its children are present the fee is " +
          "counted more than once — the production code reads neither flag.",
      },
      partialSettlements: {
        rows: partial.length,
        amountField: round(sum(partial)),
        partOfAmountField: round(
          partial.reduce((t, r) => t + money(r.part_of_amount), 0)
        ),
        note: "Where these differ, `amount` overstates what actually moved.",
      },

      byCategory: Object.fromEntries(
        [...new Set(byDue.map((r) => r.category?.name ?? "(none)"))].map((c) => [
          c,
          round(sum(byDue.filter((r) => (r.category?.name ?? "(none)") === c))),
        ])
      ),

      ...(withRows
        ? {
            rows: byDue.map((r) => ({
              id: r.id,
              account: r.account,
              category: r.category?.name ?? null,
              amount: money(r.amount),
              partOfAmount: money(r.part_of_amount),
              dueDate: r.due_date ?? null,
              reconciledOn: r.incoming_transaction?.reconciliation_date ?? null,
              transferDate: r.payment_batch?.transfer_date ?? null,
              batchStatus: r.payment_batch?.status ?? null,
              isParent: r.secondary_payment?.is_parent ?? false,
              isChild: r.secondary_payment?.is_child ?? false,
              parentId: r.secondary_payment?.parent_payment_id ?? null,
              property: r.incoming_transaction?.property?.name ?? null,
              description: r.description ?? null,
            })),
          }
        : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), month, name },
      { status: 500 }
    );
  }
}
