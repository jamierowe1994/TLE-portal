import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { getPropolyMoveInForecast } from "@/lib/propoly-deals";

// Move-in tracker: completed MTD + forward forecast (active Propoly deals by
// move-in month) + quarter/YTD rollups, with the comparison figures the
// trend arrows need. All Propoly — REX doesn't hold move-ins.

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = userId ? await findById(userId) : null;
  if (!admin || !isAdminEmail(admin.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tracker = await getPropolyMoveInForecast().catch(() => null);
  return NextResponse.json({ configured: tracker != null, tracker });
}
