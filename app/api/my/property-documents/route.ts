import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { resolveRexUserId } from "@/lib/agent-link";
import {
  getAgentListings,
  getAgentPortfolioProperties,
  getListingDocuments,
} from "@/lib/rex-stats";
import { listPropertyFiles } from "@/lib/property-files-store";

// Everything on file for a property, from both sides:
//   - `rex`     — documents staff uploaded to the REX record. Listed only;
//                 REX exposes no download method, so these link back to REX.
//   - `portal`  — files uploaded here, which we can serve directly.
//
// GET /api/my/property-documents?listingId=X → { rex, portal }
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const listingId = req.nextUrl.searchParams.get("listingId")?.trim();
  if (!listingId) {
    return NextResponse.json({ error: "listingId is required." }, { status: 400 });
  }

  // Scoped: only a property that's already the agent's own, across both books.
  const rexUserId = await resolveRexUserId(user);
  if (!rexUserId) return NextResponse.json({ rex: [], portal: [] });
  const [listings, portfolio] = await Promise.all([
    getAgentListings(rexUserId).catch(() => null),
    getAgentPortfolioProperties(rexUserId).catch(() => null),
  ]);
  const mine =
    listings?.some((l) => l.id === listingId) ||
    portfolio?.some((p) => p.listingId === listingId);
  if (!mine) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const [rex, portal] = await Promise.all([
    getListingDocuments(listingId).catch(() => []),
    listPropertyFiles(listingId).catch(() => []),
  ]);
  return NextResponse.json({ rex, portal });
}
