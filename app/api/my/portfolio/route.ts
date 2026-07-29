import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { resolveRexUserId } from "@/lib/agent-link";
import { getAgentPortfolioProperties } from "@/lib/rex-stats";

// The signed-in agent's managed portfolio — REX "leased" listings with their
// compliance/renewals, worst first. "View Listing" links are built client-side
// from lib/rex-links.
//
// GET /api/my/portfolio → { linked, properties, error? }
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const rexUserId = await resolveRexUserId(user);
  if (!rexUserId) {
    return NextResponse.json({ linked: false, properties: [] });
  }

  const properties = await getAgentPortfolioProperties(rexUserId);
  if (properties == null) {
    // Never imply an empty book when we simply couldn't ask.
    return NextResponse.json({
      linked: true,
      properties: [],
      error: "Couldn't reach REX just now — your portfolio will be back shortly.",
    });
  }
  return NextResponse.json({ linked: true, properties });
}
