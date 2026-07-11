import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { getAgentMetaStats } from "@/lib/meta";

// The signed-in agent's OWN live Meta ad stats — insights for the campaign(s)
// the admin tagged on their profile (?preset=last_7d|last_14d|last_30d|last_90d).
// Returns { configured: false } until both the token and their campaign id(s)
// exist, so the dashboard can show snapshot placeholders honestly.
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const user = await findById(userId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const preset = req.nextUrl.searchParams.get("preset");
  const stats = await getAgentMetaStats(user, preset);
  return NextResponse.json(stats);
}
