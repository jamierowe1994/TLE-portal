import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById, updateUser } from "@/lib/users-store";
import { adsApiConfigured, fetchAgentAds } from "@/lib/ads-client";

// The agent's My-Ads connection to the sister Ads app.
//   GET    → { canConnect, connected }
//   POST   → verify the Ads app knows this email, then link. { connected, configured }
//   DELETE → unlink. { connected: false }

async function requireUser(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  return findById(userId);
}

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  return NextResponse.json({ canConnect: adsApiConfigured(), connected: !!user.adsConnected });
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  if (!adsApiConfigured()) {
    return NextResponse.json(
      { connected: false, error: "The ads connection isn't set up on the portal yet — ask head office." },
      { status: 400 }
    );
  }

  const result = await fetchAgentAds(user.email);
  if (!result) {
    return NextResponse.json(
      { connected: false, error: "Couldn't reach the Ads app just now — try again in a moment." },
      { status: 502 }
    );
  }
  if (!result.found) {
    return NextResponse.json(
      {
        connected: false,
        error: `We couldn't find any ads under ${user.email}. Make sure you use the same email as your Ads-app login, then try again.`,
      },
      { status: 404 }
    );
  }

  await updateUser(user.id, { adsConnected: true });
  return NextResponse.json({ connected: true, configured: result.configured });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  await updateUser(user.id, { adsConnected: false });
  return NextResponse.json({ connected: false });
}
