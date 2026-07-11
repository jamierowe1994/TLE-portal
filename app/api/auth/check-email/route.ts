import { NextRequest, NextResponse } from "next/server";
import { isAllowedEmailDomain } from "@/lib/brand";
import { findByEmail } from "@/lib/users-store";

// POST /api/auth/check-email — body { email } → { exists, allowed }.
// Used by the signup wizard to catch returning users and blocked domains
// early. `exists` is only looked up when the domain is allowed.

export async function POST(req: NextRequest) {
  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ exists: false, allowed: false });
  }

  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ exists: false, allowed: false });
  }

  const allowed = isAllowedEmailDomain(email);
  const exists = allowed ? !!(await findByEmail(email)) : false;
  return NextResponse.json({ exists, allowed });
}
