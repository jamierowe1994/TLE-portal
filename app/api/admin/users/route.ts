import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById, listUsers, updateUser, toAdmin } from "@/lib/users-store";
import type { StoredUser } from "@/lib/users-store";
import type { AdminNote } from "@/lib/types";
import { ROSTER } from "@/lib/seed-data";

// Admin user management: list portal accounts and link them to the business
// (agentKey ↔ roster, rexUserId ↔ REX AccountUsers, metaCampaignId ↔ Meta).
// Session + ADMIN_EMAILS gated.

async function requireAdmin(
  req: NextRequest
): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) {
    return {
      ok: false,
      res: NextResponse.json({ error: "Unauthorised" }, { status: 401 }),
    };
  }
  const user = await findById(userId);
  if (!user) {
    return {
      ok: false,
      res: NextResponse.json({ error: "Unauthorised" }, { status: 401 }),
    };
  }
  if (!isAdminEmail(user.email)) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "This area is locked to the business owner." },
        { status: 403 }
      ),
    };
  }
  return { ok: true };
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;
  const users = await listUsers();
  return NextResponse.json({ users });
}

/** Nullable-string field: "" and null both clear the value. */
function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

// PATCH { userId, agentKey?, rexUserId?, metaCampaignId?, location?, note? }
// Present-key semantics: only keys present in the body are updated; sending
// null (or "") clears a field. `note` appends an admin note, never replaces.
export async function PATCH(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId : null;
  if (!userId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }
  const existing = await findById(userId);
  if (!existing) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const patch: Partial<StoredUser> = {};

  if ("agentKey" in body) {
    const agentKey = asNullableString(body.agentKey);
    if (agentKey && !ROSTER.some((r) => r.agentKey === agentKey)) {
      return NextResponse.json(
        { error: `Unknown agentKey "${agentKey}" — must match the roster.` },
        { status: 400 }
      );
    }
    patch.agentKey = agentKey;
  }
  if ("rexUserId" in body) patch.rexUserId = asNullableString(body.rexUserId);
  if ("metaCampaignId" in body)
    patch.metaCampaignId = asNullableString(body.metaCampaignId);
  if ("location" in body) patch.location = asNullableString(body.location);

  if (typeof body.note === "string" && body.note.trim()) {
    const note: AdminNote = { at: new Date().toISOString(), text: body.note.trim() };
    patch.adminNotes = [...(existing.adminNotes ?? []), note];
  }

  const updated = await updateUser(userId, patch);
  if (!updated) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }
  return NextResponse.json({ user: toAdmin(updated) });
}
