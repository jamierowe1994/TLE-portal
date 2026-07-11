import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { getRexStatus } from "@/lib/rex-stats";
import { metaConfigPresence } from "@/lib/meta";

// Integration diagnostics for the admin panel: what REX actually answers
// (capability discovery), whether Meta is wired, and which env vars are
// present. SECURITY: only presence booleans / variable NAMES are returned —
// never a secret value.

// Env vars the deploy checklist cares about. Names only; values never leave
// the server.
const ENV_CHECKLIST = [
  "AUTH_SECRET",
  "ADMIN_EMAILS",
  "DATABASE_URL",
  "DATA_DIR",
  "REX_API_BASE",
  "REX_API_EMAIL",
  "REX_API_PASSWORD",
  "REX_ACCOUNT_ID",
  "META_SYSTEM_TOKEN",
  "META_APP_SECRET",
  "META_AD_ACCOUNT_LETTINGS",
  "META_PAGE_LETTINGS",
] as const;

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

  const rex = await getRexStatus();

  return NextResponse.json({
    rex,
    meta: { configured: metaConfigPresence() },
    payprop: { status: "no-access-yet" },
    ghl: { status: "no-access-yet" },
    env: {
      present: ENV_CHECKLIST.filter((name) => !!process.env[name]),
    },
  });
}
