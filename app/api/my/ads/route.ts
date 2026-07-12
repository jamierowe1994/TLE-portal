import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { adsApiConfigured, fetchAgentAds } from "@/lib/ads-client";

// The signed-in agent's ads gallery. When they've connected to the sister Ads
// app, this proxies their live stats from there (auto-matched by email);
// otherwise it reports the connection state so the page can show the Connect
// button. ?preset=last_7d|last_14d|last_30d|last_90d.
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const user = await findById(userId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const canConnect = adsApiConfigured();
  const connected = !!user.adsConnected;
  const preset = req.nextUrl.searchParams.get("preset");

  if (!connected) {
    return NextResponse.json({ connected: false, canConnect, configured: false });
  }

  const result = await fetchAgentAds(user.email, preset);
  if (!result) {
    return NextResponse.json({ connected: true, canConnect, configured: false, error: "Couldn't reach the Ads app just now." });
  }
  if (!result.found) {
    return NextResponse.json({ connected: true, canConnect, configured: false, notFound: true });
  }
  return NextResponse.json({
    connected: true,
    canConnect,
    configured: result.configured,
    preset: result.preset,
    ads: result.ads ?? [],
    error: result.error,
  });
}
