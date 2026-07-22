import { NextRequest, NextResponse } from "next/server";
import { resolveDealAccess } from "@/lib/deal-access";
import { addNote, effectiveStatusKey, getMeta, listNotes } from "@/lib/deal-store";

// One deal's activity + notes, plus the portal meta the drawers need.
// Kirstie/admin reach any deal; an agent only their own.
//
// GET  /api/deals/:id/notes
//   → { notes, privateNotes, meta, statusKey, effectiveStatusKey }
//   notes = shared messages + system events (everyone sees these);
//   privateNotes = the VIEWER'S own private notes only.
// POST /api/deals/:id/notes  body { text, kind? } → { note }
//   kind "note" (default, shared) or "private" (author-only).

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await resolveDealAccess(req, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const [{ activity, privateNotes }, meta] = await Promise.all([
    listNotes(id, access.user.id),
    getMeta(id),
  ]);
  return NextResponse.json({
    notes: activity,
    privateNotes,
    meta,
    statusKey: access.deal.statusKey,
    effectiveStatusKey: effectiveStatusKey(access.deal.statusKey, meta),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await resolveDealAccess(req, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  let body: { text?: unknown; kind?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const text = String(body?.text ?? "").trim();
  const kind = body?.kind === "private" ? "private" : "note";
  if (!text) {
    return NextResponse.json({ error: "Write a note first." }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: "Keep notes under 2,000 characters." }, { status: 400 });
  }
  const note = await addNote({
    dealId: id,
    authorId: access.user.id,
    authorName: access.user.name || access.user.email,
    authorRole: access.role,
    kind,
    text,
  });
  return NextResponse.json({ note });
}
