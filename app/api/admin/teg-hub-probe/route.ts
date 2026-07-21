import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { tegHubConfigured, tegHubCall, getTegHeadcount, type TegBrand } from "@/lib/teg-hub";

// Diagnostic for the TEG Team Hub connection. Shows every brand the hub knows,
// the distinct statuses/packages on TLE partners, and the computed headcount —
// so we can calibrate the tile mappings against Susan's real categories
// (TLE / TLE Dual / Lettings Lite) the moment the secret goes in.

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = userId ? await findById(userId) : null;
  if (!admin || !isAdminEmail(admin.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!tegHubConfigured()) {
    return NextResponse.json({
      configured: false,
      hint: "Set TEG_HUB_API_SECRET in Railway (and .env.local) — the rotated secret from Howard.",
    });
  }

  try {
    const [ping, brands, headcount] = await Promise.all([
      tegHubCall({ action: "ping" }).catch((e: Error) => ({ error: e.message })),
      tegHubCall<TegBrand[]>({ action: "list", entity: "Brand", limit: 200 }),
      getTegHeadcount(req.nextUrl.searchParams.get("refresh") === "1"),
    ]);
    return NextResponse.json({
      configured: true,
      ping,
      brands: (brands ?? []).map((b) => ({ id: b.id, name: b.name, active: b.active })),
      headcount,
    });
  } catch (e) {
    return NextResponse.json(
      { configured: true, error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
