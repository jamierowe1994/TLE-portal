import "server-only";
import crypto from "crypto";
import { isAdminEmail } from "@/lib/brand";

// Dependency-free auth: scrypt password hashing + HMAC-signed session tokens.
// Ported from TEG PAID ADS. No middleware — every protected route handler
// verifies the cookie itself; admin routes additionally check isAdminEmail.

/**
 * Session-signing secret. In production a missing AUTH_SECRET is a hard,
 * loud failure — signing with the known dev fallback would make every
 * session token (including admin sessions) forgeable. Resolved lazily so
 * `next build` (which sets NODE_ENV=production but never signs a token)
 * still passes with zero env vars, per the offline-demo quality bar.
 */
function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET is not set — refusing to sign or verify session tokens " +
        "with the dev fallback secret in production. Set AUTH_SECRET in the " +
        "Railway variables."
    );
  }
  return "dev-only-secret-change-me-in-production";
}

export const SESSION_COOKIE = "tle_session";
const SESSION_DAYS = 30;

// Re-export so API guards can `import { isAdminEmail } from "@/lib/auth"`.
export { isAdminEmail };

/** scrypt hash in `salt:hash` hex format. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(candidate, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sign(data: string): string {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("base64url");
}

/**
 * Session token: `userId.expiryMs.signature` (base64url sig).
 * GOTCHA: format splits on "." — user ids must never contain a dot
 * (uid() in the signup route is dot-free by construction).
 */
export function createSessionToken(userId: string): string {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const data = `${userId}.${exp}`;
  return `${data}.${sign(data)}`;
}

/** Returns the userId for a valid, unexpired token; null otherwise. */
export function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  if (sign(`${userId}.${exp}`) !== sig) return null;
  if (Number(exp) < Date.now()) return null;
  return userId;
}

/** "Remember me" on → persistent 30-day cookie; off → browser-session cookie. */
export function sessionCookieOptions(remember = true) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(remember ? { maxAge: SESSION_DAYS * 24 * 60 * 60 } : {}),
  };
}
