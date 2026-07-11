import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  verifySessionToken,
  SESSION_COOKIE,
  isAdminEmail,
  hashPassword,
} from "@/lib/auth";
import { findById, updateUser } from "@/lib/users-store";

// Admin reset of an agent's password (TEG pattern): generates a temp password
// "TLE-XXXXXX", stores only its hash, and returns the plaintext ONCE in the
// response for the admin to hand to the agent. Never logged, never stored.

// Unambiguous alphabet — no 0/O, 1/I/L so the temp password survives being
// read out over the phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function tempPassword(): string {
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return `TLE-${suffix}`;
}

export async function POST(req: NextRequest) {
  const adminId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const admin = await findById(adminId);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!isAdminEmail(admin.email)) {
    return NextResponse.json(
      { error: "This area is locked to the business owner." },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const userId = typeof body.userId === "string" ? body.userId : null;
  if (!userId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }

  const target = await findById(userId);
  if (!target) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const password = tempPassword();
  const updated = await updateUser(userId, {
    passwordHash: hashPassword(password),
  });
  if (!updated) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  return NextResponse.json({ tempPassword: password });
}
