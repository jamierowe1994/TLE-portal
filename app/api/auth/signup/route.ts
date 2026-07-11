import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  hashPassword,
} from "@/lib/auth";
import { isAllowedEmailDomain, BRAND } from "@/lib/brand";
import { ROSTER } from "@/lib/seed-data";
import {
  createUser,
  findByEmail,
  toPublic,
  type StoredUser,
} from "@/lib/users-store";

// POST /api/auth/signup — body { name, email, password, mobile?, photo? }.
// Single-brand portal: no brandId. Domain-gated. Auto-links agentKey when the
// signup name matches a roster displayName (case-insensitive, trimmed).

/** Dot-free id — the session token format splits on "." */
function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function POST(req: NextRequest) {
  let body: {
    name?: unknown;
    email?: unknown;
    password?: unknown;
    mobile?: unknown;
    photo?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  if (!name) {
    return NextResponse.json({ error: "Enter your name." }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (!isAllowedEmailDomain(email)) {
    return NextResponse.json(
      {
        error: `This is the partner portal for ${BRAND.name}. Please register with your company email address (e.g. yourname@${BRAND.domains[0]}). If you believe this is a mistake, contact your head office.`,
      },
      { status: 403 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }
  if (await findByEmail(email)) {
    return NextResponse.json(
      { error: "An account with that email already exists. Sign in instead." },
      { status: 409 }
    );
  }

  // Auto-link to the seed roster when the name matches a partner exactly.
  const rosterMatch = ROSTER.find(
    (r) => r.displayName.trim().toLowerCase() === name.toLowerCase()
  );

  const user: StoredUser = {
    id: uid(),
    name,
    email,
    mobile: String(body?.mobile ?? "").trim(),
    photo: typeof body?.photo === "string" ? body.photo : null,
    agentKey: rosterMatch?.agentKey ?? null,
    rexUserId: null,
    metaCampaignId: null,
    location: null,
    createdAt: new Date().toISOString(),
    passwordHash: hashPassword(password),
    adminNotes: [],
  };
  await createUser(user);

  const res = NextResponse.json({ user: toPublic(user) });
  res.cookies.set(
    SESSION_COOKIE,
    createSessionToken(user.id),
    sessionCookieOptions()
  );
  return res;
}
