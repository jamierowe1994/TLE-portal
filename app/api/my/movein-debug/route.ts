import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { getMoveIns } from "@/lib/payprop-income";
import { getAgentBook, getPortfolioBook, normaliseAgentName } from "@/lib/payprop-portfolio";
import { currentMonth } from "@/lib/format";

// Why a partner's move-ins tile is amber.
//
// The tile joins PayProp's move-ins to the partner's own properties by
// property name, which means it can fail at either end: PayProp might spell
// their name differently from the portal (so they get no book at all), or the
// property names might not line up (so the book exists but nothing matches).
// Those look identical on screen, so this says which it is.
//
// GET /api/my/movein-debug?month=YYYY-MM
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const month = req.nextUrl.searchParams.get("month") ?? currentMonth();
  try {
  const name = user.name ?? "";
  const book = getAgentBook(name);
  const all = getMoveIns(month);
  const portfolio = getPortfolioBook();

  const mineIds = new Set(book?.propertyIds ?? []);
  const mineKeys = new Set(book?.propertyKeys ?? []);
  const matched = (all?.properties ?? []).filter(
    (p) =>
      (p.propertyId && mineIds.has(p.propertyId)) ||
      (p.propertyKey && mineKeys.has(p.propertyKey))
  );

    return NextResponse.json({
      month,
      you: { name, normalised: normaliseAgentName(name) },

    // Has the portfolio walk finished? Everything below is meaningless if not.
    portfolioLoaded: portfolio != null,
    moveInsLoaded: all != null,

    // Did PayProp recognise them as a responsible agent?
    book: book
      ? {
          matchedNames: book.names,
          properties: book.properties,
          samplePropertyNames: (book.propertyNames ?? []).slice(0, 5),
          samplePropertyIds: (book.propertyIds ?? []).slice(0, 5),
          samplePropertyKeys: (book.propertyKeys ?? []).slice(0, 5),
        }
      : null,

    // Every agent name PayProp holds — for spotting a near-miss spelling.
    knownAgentNames: portfolio ? Object.keys(portfolio.byAgent).sort() : [],

    moveIns: {
      businessWide: all?.count ?? null,
      samplePropertyNames: (all?.properties ?? []).slice(0, 5).map((p) => p.property),
      samplePropertyIds: (all?.properties ?? []).slice(0, 5).map((p) => p.propertyId),
      samplePropertyKeys: (all?.properties ?? []).slice(0, 5).map((p) => p.propertyKey),
      matchedToYou: matched.length,
      matchedRows: matched,
    },

    verdict: !portfolio
      ? "Portfolio walk hasn't finished — try again shortly."
      : !book?.properties
        ? "PayProp has no properties under your name — check `knownAgentNames` for how it spells you."
        : matched.length === 0 && (all?.count ?? 0) > 0
          ? "You have properties, but none of this month's move-ins are on them — most likely genuinely none this month, since the join is now on PayProp ids rather than names."
          : "Joined fine — the tile should be live.",
    });
  } catch (e) {
    // A blank page is the least useful failure there is — a debug route that
    // dies silently is worse than no debug route.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), month },
      { status: 500 }
    );
  }
}
