import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById, updateUser, toAdmin } from "@/lib/users-store";
import { rexConfigured, rexFindUser } from "@/lib/rex";

// Admin-only: find an agent's REX user id by probing REX for their email, and
// assign it. This is the one-click fallback for when signup couldn't auto-link
// them (e.g. they were added to REX after signing up).
//
// POST { userId } → { linked: true, user } | { linked: false, reason }
export async function POST(req: NextRequest) {
  const adminId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = adminId ? await findById(adminId) : null;
  if (!admin) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!isAdminEmail(admin.email)) {
    return NextResponse.json(
      { error: "This area is locked to the business owner." },
      { status: 403 }
    );
  }
  if (!rexConfigured()) {
    return NextResponse.json(
      { linked: false, reason: "REX isn't connected on this server." },
      { status: 200 }
    );
  }

  const body = (await req.json().catch(() => null)) as { userId?: unknown } | null;
  const userId = String(body?.userId ?? "").trim();
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  const target = await findById(userId);
  if (!target) {
    return NextResponse.json({ error: "No such user" }, { status: 404 });
  }

  const hit = await rexFindUser(target.email, target.name).catch(() => null);
  if (!hit) {
    return NextResponse.json({
      linked: false,
      reason: `No REX user matched ${target.email} or the name "${target.name}". Check they're in REX, then try again — or paste their AccountUsers id.`,
    });
  }

  const updated = await updateUser(userId, { rexUserId: hit.id });
  return NextResponse.json({
    linked: true,
    rexUserId: hit.id,
    matchedBy: hit.matchedBy,
    matchedEmail: hit.email,
    user: updated ? toAdmin(updated) : null,
  });
}
