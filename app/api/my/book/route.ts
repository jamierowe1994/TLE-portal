import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { payPropConfigured } from "@/lib/payprop";
import { getAgentBook, getPortfolioBook } from "@/lib/payprop-portfolio";
import { getArrears } from "@/lib/payprop-income";

// The signed-in partner's managed book: how many properties they run, the rent
// under management, and what's currently owed on it.
//
// Matched on their name as PayProp spells it in `responsible_agent`. Where a
// name maps to more than one partner it isn't attributed at all — under-
// reporting is recoverable, misattributing someone else's arrears is not.
//
// GET /api/my/book → { book, arrears, matched }
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!payPropConfigured()) return NextResponse.json({ connected: false, book: null });

  const book = await getAgentBook(user.name);

  // Their arrears: tenant balances on properties they're responsible for.
  let arrears: { count: number; owed: number } | null = null;
  const balances = await getArrears();
  if (balances && book) {
    // Tenant balances name the property, not the agent, so match on the
    // property names that belong to this partner's book.
    const owned = new Set(book.propertyNames.map((n) => n.toLowerCase()));
    const rows = balances.tenants.filter((t) => owned.has(t.property.toLowerCase()));
    arrears = { count: rows.length, owed: rows.reduce((s, x) => s + x.owed, 0) };
  }

  return NextResponse.json({
    connected: true,
    matched: (book?.properties ?? 0) > 0,
    book,
    arrears,
  });
}
