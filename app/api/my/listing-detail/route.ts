import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { resolveRexUserId } from "@/lib/agent-link";
import { getAgentListings, getListingDetail } from "@/lib/rex-stats";

// The extra detail behind one property drawer — advert copy, room counts and
// the activity strip. Fetched on open rather than with the grid, because the
// room counts need a Properties read per property.
//
// GET /api/my/listing-detail?id=<listingId> → { detail } | { error }
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  // Scope it: an agent only reads detail for a listing that's already theirs.
  // getAgentListings is cached, so this check is nearly free.
  const rexUserId = await resolveRexUserId(user);
  const mine = rexUserId ? await getAgentListings(rexUserId) : null;
  if (!mine?.some((l) => l.id === id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const detail = await getListingDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "Couldn't reach REX just now." }, { status: 502 });
  }
  return NextResponse.json({ detail });
}
