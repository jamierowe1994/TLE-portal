import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { isAdminEmail } from "@/lib/brand";
import { getComplianceAsAt } from "@/lib/rex-stats";

/**
 * Business-wide compliance straight from REX, for Susan's Compliance tab.
 *
 * GET /api/admin/compliance-live?month=YYYY-MM → { compliance }
 *
 * `month` scopes the FLOWS only (recorded in the month, expiring in the
 * month). The stock — valid / expiring / overdue — is as at today and cannot
 * honestly be anything else: REX edits a compliance entry in place when a
 * certificate is renewed, so a rewind would report a renewed property as
 * having been compliant during the very months it wasn't. Measured 11 Aug 2026;
 * the reasoning and the numbers are in lib/rex-stats.ts.
 *
 * The sweep takes ~2 minutes cold, so a first call may return null while it
 * runs. Poll — do not treat null as zero.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const param = req.nextUrl.searchParams.get("month");
  const month = param && MONTH_RE.test(param) ? param : new Date().toISOString().slice(0, 7);
  const compliance = await getComplianceAsAt(month).catch(() => null);
  // Echoed so the tab can drop an answer that arrived for a month the user has
  // already navigated away from — the exact race that made the Overview show
  // one month's figures under another's heading.
  return NextResponse.json({ month, compliance });
}
