import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { resolveRexUserId } from "@/lib/agent-link";
import { getAgentListings } from "@/lib/rex-stats";

// The signed-in agent's live properties, straight from REX. Scoped by their own
// linked rexUserId — an agent only ever sees their own listings.
//
// GET /api/my/listings → { linked, listings, error? }
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Links them on the fly if they signed up before we auto-linked at signup.
  // Only genuinely unmatchable agents fall through to "not linked".
  const rexUserId = await resolveRexUserId(user);
  if (!rexUserId) {
    return NextResponse.json({ linked: false, listings: [] });
  }

  const listings = await getAgentListings(rexUserId);
  if (listings == null) {
    return NextResponse.json({
      linked: true,
      listings: [],
      error: "Couldn't reach REX just now — your properties will be back shortly.",
    });
  }
  return NextResponse.json({ linked: true, listings });
}
