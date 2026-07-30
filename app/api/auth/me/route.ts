import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  verifySessionToken,
} from "@/lib/auth";
import {
  findById,
  toPublic,
  updateUser,
  type StoredUser,
} from "@/lib/users-store";

// GET  /api/auth/me   — current session user (isAdmin derived via toPublic).
// PATCH /api/auth/me  — name / mobile / photo / bio, plus password change with
//                       { currentPassword, newPassword } (current verified).

async function currentUserId(req: NextRequest): Promise<string | null> {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

export async function GET(req: NextRequest) {
  const userId = await currentUserId(req);
  if (!userId) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  const user = await findById(userId);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user: toPublic(user) });
}

export async function PATCH(req: NextRequest) {
  const userId = await currentUserId(req);
  if (!userId) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  const user = await findById(userId);
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  let body: {
    name?: unknown;
    mobile?: unknown;
    photo?: unknown;
    bio?: unknown;
    currentPassword?: unknown;
    newPassword?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const patch: Partial<StoredUser> = {};

  if (typeof body?.name === "string" && body.name.trim()) {
    patch.name = body.name.trim();
  }
  if (typeof body?.mobile === "string") {
    patch.mobile = body.mobile.trim();
  }
  if (typeof body?.photo === "string" || body?.photo === null) {
    patch.photo = body.photo;
  }
  if (typeof body?.bio === "string" || body?.bio === null) {
    // Kept short enough to sit in a card without becoming an essay.
    patch.bio = typeof body.bio === "string" ? body.bio.trim().slice(0, 600) : null;
  }

  // Password change — requires the current password to be verified first.
  if (body?.newPassword !== undefined) {
    const currentPassword = String(body?.currentPassword ?? "");
    const newPassword = String(body?.newPassword ?? "");
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      return NextResponse.json(
        { error: "Your current password is incorrect." },
        { status: 400 }
      );
    }
    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "New password must be at least 8 characters." },
        { status: 400 }
      );
    }
    patch.passwordHash = hashPassword(newPassword);
  }

  const updated = await updateUser(userId, patch);
  if (!updated) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user: toPublic(updated) });
}
