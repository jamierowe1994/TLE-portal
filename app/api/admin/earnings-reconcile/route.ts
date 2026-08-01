import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { payPropConfigured } from "@/lib/payprop";
import { auditRowsForRange, agentBeneficiaryIds } from "@/lib/payprop-income";
import { getPortfolioBook } from "@/lib/payprop-portfolio";

// EVERY partner, EVERY month, in one response.
//
// The single-partner audit answered June exactly and then failed on May, and
// chasing that one partner-month at a time means a round trip per cell of a
// table nobody has drawn yet. This draws the whole table.
//
// It reuses the SAME cached walk the dashboard uses rather than re-fetching
// raw pages per partner per month — three months raw is a couple of hundred
// sequential PayProp calls, this is one, and it is already persisted. The cost
// is that part_of_amount and the secondary_payment flags are not in the
// reduced shape; those live in the single-partner detail mode, and neither has
// yet turned up an error anyway.
//
// GET /api/admin/earnings-reconcile?months=2026-04,2026-05,2026-06
//     &names=Rhiannon Dodge,Kirstie Wallington   (default: every partner)
//
// Compare the columns against the sheet. Whichever column matches is the basis
// the business actually uses, and that is the whole question.

const FEE_CATEGORIES = new Set([
  "Management Fee",
  "Monthly Management Fee",
  "First Month Management Fee",
  "Set Up Fee",
  "Management Fee - Investor Services",
  "Rent and Legal Protection",
]);

const round = (n: number) => Math.round(n * 100) / 100;

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
  if (!payPropConfigured()) return NextResponse.json({ configured: false });

  const q = req.nextUrl.searchParams;
  const months = (q.get("months") ?? q.get("month") ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => /^\d{4}-\d{2}$/.test(m))
    .sort();
  if (months.length === 0) {
    return NextResponse.json(
      { error: "Need ?months=YYYY-MM,YYYY-MM" },
      { status: 400 }
    );
  }
  // Guard the SPAN, not the count. The first version capped the count at three
  // and then died on 2026-04,2026-06,2026-07 — three months, but April to July
  // widens to a six-month walk of roughly 250 sequential PayProp pages, which
  // is both slow enough to time out and heavy enough to trip the rate limiter
  // that live traffic shares.
  const spanMonths = (() => {
    const [ay, am] = months[0].split("-").map(Number);
    const [by, bm] = months[months.length - 1].split("-").map(Number);
    return (by - ay) * 12 + (bm - am) + 1;
  })();
  if (spanMonths > 4) {
    return NextResponse.json(
      {
        error: `${months[0]} to ${months[months.length - 1]} spans ${spanMonths} months. Keep it to 4 — each month is walked with a month either side, and a wider window is a walk long enough to time out and heavy enough to slow the live dashboard.`,
      },
      { status: 400 }
    );
  }

  try {
    const book = await getPortfolioBook();
    const requested = (q.get("names") ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    // Default to every partner PayProp actually pays, biggest book first —
    // reconciling one partner proves nothing about the other thirty.
    const partners = requested.length
      ? requested
      : Object.values(book?.byAgent ?? {})
          .filter((a) => a.names.length && a.properties > 0)
          .sort((x, y) => y.properties - x.properties)
          .map((a) => a.names[0]);

    const shift = (iso: string, delta: number, end: boolean) => {
      const [y, m] = iso.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1 + delta, 1));
      if (end) d.setUTCMonth(d.getUTCMonth() + 1, 0);
      return d.toISOString().slice(0, 10);
    };

    // Fetch PER MONTH, on exactly the ranges paymentsDueInRange already uses.
    // A union range would be one bespoke cache key nothing else ever reads; a
    // month at a time hits the same keys the dashboard fills, so a warm
    // dashboard makes this free and a cold one leaves the cache warm for it.
    //
    // And one bad month no longer loses the whole table: payPropGetAll refuses
    // to report a partial figure, which is right, but that refusal should cost
    // one column rather than all of them.
    const byMonthRows = new Map<string, Array<{ a: number; c: string; b: string; d: string; rd: string; p: string }>>();
    const failedMonths: Array<{ month: string; error: string }> = [];
    for (const month of months) {
      try {
        const got = await auditRowsForRange(shift(month, -1, false), shift(month, 1, true));
        byMonthRows.set(month, got.filter((r) => FEE_CATEGORIES.has(r.c)));
      } catch (e) {
        failedMonths.push({
          month,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const usable = months.filter((m) => byMonthRows.has(m));
    if (usable.length === 0) {
      return NextResponse.json(
        {
          error: "No month could be walked in full.",
          failedMonths,
          hint: "PayProp refused a page after retries — usually the rate limiter. Try one month.",
        },
        { status: 502 }
      );
    }

    const results = [];
    for (const name of partners) {
      const { ids, matchedBy } = await agentBeneficiaryIds("", name);
      if (ids.length === 0) {
        results.push({ name, matched: false });
        continue;
      }
      const idSet = new Set(ids);
      const propertyIds = new Set(
        Object.values(book?.byAgent ?? {}).find((a) => a.names.includes(name))
          ?.propertyIds ?? []
      );

      const perMonth: Record<string, unknown> = {};
      for (const month of usable) {
        const feeRows = byMonthRows.get(month) ?? [];
        const mine = feeRows.filter((r) => r.b && idSet.has(r.b));
        const onTheirProperties = feeRows.filter((r) => r.p && propertyIds.has(r.p));
        const inM = (d: string) => d.slice(0, 7) === month;
        const due = mine.filter((r) => inM(r.d));
        const recon = mine.filter((r) => inM(r.rd));
        const propDue = onTheirProperties.filter((r) => inM(r.d));
        const total = (rs: typeof mine) => round(rs.reduce((t, r) => t + r.a, 0));
        perMonth[month] = {
          paidToThem: {
            byDueDate: total(due),
            byReconciliationDate: total(recon),
          },
          onTheirProperties: { byDueDate: total(propDue) },
          rows: { byDueDate: due.length, byReconciliationDate: recon.length },
        };
      }
      results.push({ name, matched: true, matchedBy, perMonth });
    }

    return NextResponse.json({
      months: usable,
      ...(failedMonths.length ? { failedMonths } : {}),
      partners: results.length,
      howToRead:
        "Per partner per month: paidToThem is what PayProp paid that person; " +
        "onTheirProperties is what was charged on properties they run, whoever " +
        "was paid. Compare each against the sheet — the column that matches is " +
        "the basis the business uses.",
      results,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), months },
      { status: 500 }
    );
  }
}
