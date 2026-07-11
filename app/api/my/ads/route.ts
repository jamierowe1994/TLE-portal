import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { getAgentAds } from "@/lib/meta";

// The signed-in agent's ads gallery: every ad in their tagged campaign(s)
// (cap 12), each with its creative thumbnail and its own figures for the
// chosen range (?preset=). { configured: false } until the campaign link
// exists.
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
  const result = await getAgentAds(user, preset);
  return NextResponse.json(result);
}
