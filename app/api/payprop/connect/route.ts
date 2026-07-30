import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { isAdminEmail } from "@/lib/brand";
import { payPropAuthorizeUrl, payPropClient, type PayPropAccountId } from "@/lib/payprop";
import crypto from "crypto";

// Start the PayProp connection. Admin only — this authorises the whole agency
// account, not one agent's view.
//
// GET /api/payprop/connect?account=uk|scotland
//
// Sends the user to PayProp to sign in and consent, then PayProp returns them
// to /api/payprop/callback with a code. The `state` value is kept in a
// short-lived cookie and checked on the way back, so a link someone else
// crafted can't complete a connection.
//
// Note PayProp rejects http:// redirect URIs, so this only works on the
// deployed https site — not localhost.
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Forgiving: no param, an empty one, odd casing or stray spaces all land on
  // the UK account rather than a dead end.
  const raw = (req.nextUrl.searchParams.get("account") ?? "").trim().toLowerCase();
  const account = (raw === "" ? "uk" : raw) as PayPropAccountId;
  if (account !== "uk" && account !== "scotland") {
    return NextResponse.json(
      { error: `account must be uk or scotland — received "${raw}".` },
      { status: 400 }
    );
  }

  const creds = payPropClient(account);
  if (!creds) {
    return NextResponse.json(
      { error: "Set PAYPROP_CLIENT_ID and PAYPROP_CLIENT_SECRET first." },
      { status: 503 }
    );
  }

  // Explicit wins: behind a proxy the request origin can differ from the
  // public URL, and PayProp matches redirect_uri byte-for-byte on exchange.
  const origin = (process.env.PAYPROP_REDIRECT_ORIGIN ?? req.nextUrl.origin).replace(/\/+$/, "");
  if (!origin.startsWith("https://")) {
    return NextResponse.json(
      {
        error:
          "PayProp only accepts https redirect URIs, so connect from the deployed site rather than localhost.",
      },
      { status: 400 }
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${origin}/api/payprop/callback`;

  const res = NextResponse.redirect(
    payPropAuthorizeUrl({ clientId: creds.id, redirectUri, state })
  );
  // Round-trips with the user; consumed by the callback.
  res.cookies.set("payprop_oauth", JSON.stringify({ state, account }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
