import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
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

  // Not linked to REX yet — the dashboard already prompts them to get linked,
  // so say so plainly rather than showing an empty list as if they had none.
  if (!user.rexUserId) {
    return NextResponse.json({ linked: false, listings: [] });
  }

  const listings = await getAgentListings(user.rexUserId);
  if (listings == null) {
    return NextResponse.json({
      linked: true,
      listings: [],
      error: "Couldn't reach REX just now — your properties will be back shortly.",
    });
  }
  return NextResponse.json({ linked: true, listings });
}
