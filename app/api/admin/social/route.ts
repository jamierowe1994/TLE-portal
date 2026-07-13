import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { fetchBrandSocial, socialApiConfigured } from "@/lib/social-client";

// Admin-only: The Lettings Expert's organic socials (Facebook + Instagram
// followers + growth), pulled live from the sister ads platform's partner API.
// GET ?preset=<last_7d|last_14d|last_30d|last_90d>
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!isAdminEmail(user.email)) {
    return NextResponse.json(
      { error: "This area is locked to the business owner." },
      { status: 403 }
    );
  }

  const preset = req.nextUrl.searchParams.get("preset") ?? "last_30d";
  const social = await fetchBrandSocial(preset);
  return NextResponse.json({
    configured: socialApiConfigured(),
    preset,
    social,
  });
}
