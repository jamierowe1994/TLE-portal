import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { payPropConfigured } from "@/lib/payprop";
import { getAgentEarnings, describeAgentMatch, payPropRefreshing } from "@/lib/payprop-income";
import { currentMonth } from "@/lib/format";

// The signed-in partner's own commission for a month, live from PayProp.
// Matched on their email, which is both their portal login and their
// PayProp beneficiary address.
//
// GET /api/my/earnings?month=YYYY-MM → { earnings, refreshing }
//
// Never blocks: the first call returns null while the figures are gathered
// in the background, so the dashboard falls back to the snapshot rather than
// hanging on a slow walk through PayProp.
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  if (!payPropConfigured()) {
    return NextResponse.json({ connected: false, earnings: null });
  }

  const month = req.nextUrl.searchParams.get("month") ?? currentMonth();
  const earnings = getAgentEarnings(user.email, month, user.name ?? "");

  // ?debug=1 explains the match instead of leaving an unmatched partner as an
  // unexplained snapshot. Scoped to the signed-in user's own lookup.
  const debug = req.nextUrl.searchParams.get("debug")
    ? await describeAgentMatch(user.email, user.name ?? "").catch((e: unknown) => ({
        error: e instanceof Error ? e.message : String(e),
      }))
    : undefined;

  return NextResponse.json({
    connected: true,
    month,
    earnings,
    ...(debug ? { debug } : {}),
    refreshing: payPropRefreshing(),
  });
}
