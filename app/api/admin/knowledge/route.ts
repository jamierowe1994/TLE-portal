import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import {
  listKnowledge,
  upsertKnowledge,
  deleteKnowledge,
} from "@/lib/knowledge-store";

// Admin-only CRUD for the assistant knowledge base (Admin → Assistant).
//   GET    /api/admin/knowledge          → { entries }
//   POST   /api/admin/knowledge          { id?, title, content } → { entry }
//   DELETE /api/admin/knowledge?id=...   → { deleted }

async function requireAdmin(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorised" }, { status: 401 }) };
  }
  if (!isAdminEmail(user.email)) {
    return {
      error: NextResponse.json(
        { error: "This area is locked to the business owner." },
        { status: 403 }
      ),
    };
  }
  return { user };
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate.error) return gate.error;
  return NextResponse.json({ entries: await listKnowledge() });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate.error) return gate.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const { id, title, content } = (body ?? {}) as {
    id?: string;
    title?: string;
    content?: string;
  };
  if (typeof title !== "string" || typeof content !== "string") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    const entry = await upsertKnowledge({ id: id ?? null, title, content });
    return NextResponse.json({ entry });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Couldn't save that entry." },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate.error) return gate.error;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  return NextResponse.json({ deleted: await deleteKnowledge(id) });
}
