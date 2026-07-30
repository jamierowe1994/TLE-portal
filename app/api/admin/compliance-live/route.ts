import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { isAdminEmail } from "@/lib/brand";
import { getBusinessCompliance } from "@/lib/rex-stats";

// Business-wide compliance straight from REX, for Susan's Compliance tab.
// GET /api/admin/compliance-live → { compliance }
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return NextResponse.json({ compliance: await getBusinessCompliance() });
}
