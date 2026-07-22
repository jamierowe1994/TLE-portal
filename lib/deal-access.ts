import "server-only";
import type { NextRequest } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { isPreTenancyEmail } from "@/lib/brand";
import { findById, type StoredUser } from "@/lib/users-store";
import {
  dealBelongsToUser,
  getAllPropolyDeals,
  type BusinessDeal,
} from "@/lib/propoly-deals";
import type { DealNoteRole } from "@/lib/types";

// Who may touch a deal's notes/meta: pre-tenancy (Kirstie) and admins see
// every deal; an agent only their own (matched the same way their
// Applications list is built, so the two views can never disagree).

export type DealAccess =
  | { ok: true; user: StoredUser; deal: BusinessDeal; role: DealNoteRole }
  | { ok: false; status: number; error: string };

export async function resolveDealAccess(
  req: NextRequest,
  dealId: string
): Promise<DealAccess> {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return { ok: false, status: 401, error: "Unauthorised" };

  // Distinguish "Propoly unreachable / cache warming" (retryable 503) from
  // "that deal genuinely doesn't exist" (404).
  const deals = await getAllPropolyDeals().catch(() => null);
  if (deals == null) {
    return {
      ok: false,
      status: 503,
      error: "Propoly is warming up — try again in a few seconds.",
    };
  }
  const deal = deals.find((d) => d.app.id === dealId);
  if (!deal) {
    return { ok: false, status: 404, error: "Couldn't find that deal in Propoly." };
  }

  const role: DealNoteRole = isPreTenancyEmail(user.email)
    ? "pretenancy"
    : isAdminEmail(user.email)
      ? "admin"
      : "agent";
  if (
    role === "agent" &&
    !dealBelongsToUser(deal, { email: user.email, agentKey: user.agentKey ?? null })
  ) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, user, deal, role };
}
