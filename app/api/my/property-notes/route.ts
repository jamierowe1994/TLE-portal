import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { addPropertyNote, listPropertyNotes } from "@/lib/property-notes-store";

// The conversation log on a property drawer. Any signed-in portal user can
// read and write a listing's thread — agents leave notes for the pre-tenancy
// team and vice versa; admins (Kirstie/Susan) post as "team" so their bubbles
// sit on the other side.
//
// GET  /api/my/property-notes?listingId=X → { notes }
// POST /api/my/property-notes  body { listingId, text } → { note }

async function requireUser(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  return userId ? await findById(userId) : null;
}

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const listingId = req.nextUrl.searchParams.get("listingId")?.trim();
  if (!listingId) {
    return NextResponse.json({ error: "listingId is required." }, { status: 400 });
  }
  const notes = await listPropertyNotes(listingId);
  return NextResponse.json({ notes, me: user.id });
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: { listingId?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const listingId = String(body?.listingId ?? "").trim();
  const text = String(body?.text ?? "").trim();
  if (!listingId) {
    return NextResponse.json({ error: "listingId is required." }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Write a note first." }, { status: 400 });
  }

  const note = await addPropertyNote({
    listingId,
    authorId: user.id,
    authorName: user.name,
    authorRole: isAdminEmail(user.email) ? "team" : "agent",
    text,
  });
  return NextResponse.json({ note });
}
