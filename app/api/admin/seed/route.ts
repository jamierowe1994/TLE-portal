import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, isAdminEmail, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { SEED, SNAPSHOT_DATE } from "@/lib/seed-data";

// Admin-gated delivery of the full dashboard snapshot (SEED). lib/seed-data.ts
// is "server-only" — it contains tenant personal data (arrears) and owner-only
// financials (P&L, partner net income), so it must never ship in a client
// bundle. The admin tabs fetch it here instead; a valid session belonging to
// an ADMIN_EMAILS address is required, exactly like every other /api/admin/*.

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const user = await findById(userId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!isAdminEmail(user.email)) {
    return NextResponse.json(
      { error: "This area is locked to the business owner." },
      { status: 403 }
    );
  }

  return NextResponse.json(
    { seed: SEED, snapshotDate: SNAPSHOT_DATE },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
