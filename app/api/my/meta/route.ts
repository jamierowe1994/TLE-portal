import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { adsApiConfigured, fetchAgentAds } from "@/lib/ads-client";

// The signed-in agent's live ad snapshot (spend / leads / CPL etc.), proxied
// from the sister Ads app once they've connected (auto-matched by email).
// { configured: false } until connected and their campaign is wired up there.
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const user = await findById(userId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  if (!adsApiConfigured() || !user.adsConnected) {
    return NextResponse.json({ configured: false });
  }

  const preset = req.nextUrl.searchParams.get("preset");
  const result = await fetchAgentAds(user.email, preset);
  if (!result || !result.found || !result.configured || !result.snapshot) {
    return NextResponse.json({ configured: false, error: result?.error });
  }
  return NextResponse.json({
    configured: true,
    snapshot: result.snapshot,
    creatives: result.creatives ?? [],
  });
}
