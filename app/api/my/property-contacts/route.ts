import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { getListingContacts } from "@/lib/rex-stats";

// The landlord/tenant contacts on one listing, for the compliance drawer's
// "Message landlord" / "Message tenant" buttons.
//
// One REX read per opened drawer, cached 5 minutes. An empty list means we
// could NOT read them — the page says so rather than implying the property
// has no landlord.
//
// GET /api/my/property-contacts?listingId=123 → { contacts }
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const listingId = req.nextUrl.searchParams.get("listingId") ?? "";
  if (!listingId) {
    return NextResponse.json({ error: "Need ?listingId" }, { status: 400 });
  }
  const contacts = await getListingContacts(listingId).catch(() => []);
  return NextResponse.json({ contacts });
}
