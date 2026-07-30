import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { isAdminEmail } from "@/lib/brand";
import { payPropClient, type PayPropAccountId } from "@/lib/payprop";
import { savePayPropTokens } from "@/lib/payprop-tokens";

// Where PayProp sends the user back with an authorisation code. Exchanges it
// for the refresh token we keep, then hands them back to the admin centre.
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  // Send them back to the configured public URL, not the request's own origin.
  // Behind a proxy — or when PayProp returns to a host we didn't ask for —
  // the origin can be something the browser can't reach, which strands the
  // user on a dead page even though the connection succeeded.
  const home = (process.env.PAYPROP_REDIRECT_ORIGIN ?? req.nextUrl.origin).replace(/\/+$/, "");
  const done = (msg: string, ok = false) =>
    NextResponse.redirect(
      `${home}/admin?payprop=${ok ? "connected" : "failed"}&detail=${encodeURIComponent(msg)}`
    );

  const error = params.get("error");
  if (error) return done(params.get("error_description") ?? error);

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return done("PayProp didn't return a code.");

  // The state must match the one we set when the connection started.
  let pending: { state?: string; account?: PayPropAccountId } = {};
  try {
    pending = JSON.parse(req.cookies.get("payprop_oauth")?.value ?? "{}");
  } catch {
    /* treated as a mismatch below */
  }
  if (!pending.state || pending.state !== state) {
    return done("That connection link has expired — start again.");
  }

  const account = pending.account ?? "uk";
  const creds = payPropClient(account);
  if (!creds) return done("PayProp client credentials aren't set.");

  const res = await fetch(
    process.env.PAYPROP_TOKEN_URL ?? "https://uk.payprop.com/api/oauth/access_token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: creds.id,
        client_secret: creds.secret,
        redirect_uri: `${(process.env.PAYPROP_REDIRECT_ORIGIN ?? req.nextUrl.origin).replace(/\/+$/, "")}/api/payprop/callback`,
      }),
      cache: "no-store",
    }
  ).catch(() => null);

  const data = (await res?.json().catch(() => null)) as {
    refresh_token?: string;
    scopes?: string;
    error_description?: string;
  } | null;

  if (!res?.ok || !data?.refresh_token) {
    return done(data?.error_description ?? "PayProp wouldn't issue a token.");
  }

  await savePayPropTokens(account, {
    refreshToken: data.refresh_token,
    connectedBy: user.email,
    connectedAt: new Date().toISOString(),
    scopes: data.scopes ?? null,
  });

  const out = done(`${account} connected.`, true);
  out.cookies.delete("payprop_oauth");
  return out;
}
