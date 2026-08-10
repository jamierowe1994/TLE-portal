import { NextRequest, NextResponse } from "next/server";
import { payPropAccessToken, type PayPropAccountId } from "@/lib/payprop";

/**
 * Lend TLE OS a short-lived PayProp access token.
 *
 * WHY THIS EXISTS. There is exactly one PayProp connection (Susan's consent,
 * 30 Jul 2026) and PayProp has no machine-to-machine grant — confirmed
 * against both the v1.1 and v2.0 clients, which accept only
 * authorization_code and refresh_token. So the OS cannot authenticate on its
 * own, and the connection must be shared.
 *
 * This portal stays the ONLY app that ever refreshes. It hands out access
 * tokens, which expire on their own and rotate nothing. If the OS is down,
 * misconfigured or wrong, this portal's connection is untouched — which
 * matters, because this is the one in daily use.
 *
 * Guarded by a shared secret compared in constant time. No session: this is
 * server-to-server, and a browser has no business here.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Distinguishes "the bridge isn't switched on here" from "wrong secret".
 *  Whether a FEATURE is enabled is not a secret, and conflating the two
 *  makes a misconfiguration impossible to diagnose from the outside. */
function bridgeSecret(): string {
  // A long secret pasted into a dashboard arrives line-wrapped; compare the
  // cleaned form so a stray newline isn't an unexplainable 401.
  return (process.env.OS_BRIDGE_SECRET ?? "").replace(/\s+/g, "");
}

function bridgeOpen(): boolean {
  return Boolean(bridgeSecret());
}

function authorised(req: NextRequest): boolean {
  const expected = bridgeSecret();
  if (!expected) return false;
  const got = (req.headers.get("x-os-bridge") ?? "").replace(/\s+/g, "");
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function GET(req: NextRequest) {
  if (!bridgeOpen()) {
    return NextResponse.json(
      { ok: false, error: "OS_BRIDGE_SECRET is not set on the portal — the bridge is switched off here." },
      { status: 503 }
    );
  }
  if (!authorised(req)) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }
  const raw = (req.nextUrl.searchParams.get("account") ?? "uk").toLowerCase();
  const account = (raw === "scotland" ? "scotland" : "uk") as PayPropAccountId;

  try {
    const token = await payPropAccessToken(account);
    if (!token) {
      return NextResponse.json(
        { ok: false, error: `No PayProp connection for "${account}" on this environment.` },
        { status: 503 }
      );
    }
    // Access tokens are short-lived by design; nothing here is storable.
    return NextResponse.json({ ok: true, account, accessToken: token });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not mint a token." },
      { status: 502 }
    );
  }
}
