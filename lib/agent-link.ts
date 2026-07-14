import "server-only";

import { rexFindUser } from "@/lib/rex";
import { updateUser } from "@/lib/users-store";
import type { StoredUser } from "@/lib/users-store";

/**
 * The agent's REX user id — linking them on the fly if it's missing.
 *
 * Signup only started auto-linking recently, so anyone who registered before
 * that has a null rexUserId and sees "your REX account isn't linked yet" even
 * though they're sitting in REX perfectly well. Rather than make an admin go and
 * press a button for each of them, resolve it lazily the first time we need it
 * and persist the result — so the account heals itself and every later request
 * is a straight read.
 *
 * Best-effort: returns null if they genuinely can't be matched (REX down, or no
 * REX user with their email/name), and callers should say so plainly rather
 * than render an empty state as though the agent has nothing.
 */
export async function resolveRexUserId(user: StoredUser): Promise<string | null> {
  if (user.rexUserId) return user.rexUserId;

  const hit = await rexFindUser(user.email, user.name).catch(() => null);
  if (!hit) return null;

  // Persist so we only pay for the lookup once. A write failure is survivable —
  // we still return the id, we'd just look it up again next time.
  await updateUser(user.id, { rexUserId: hit.id }).catch(() => {});
  return hit.id;
}
