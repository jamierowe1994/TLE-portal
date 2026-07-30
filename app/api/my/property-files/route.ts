import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import {
  addPropertyFile,
  listPropertyFiles,
  MAX_FILE_BYTES,
} from "@/lib/property-files-store";

// Files on a property drawer — any signed-in portal user can list a
// listing's files or drop new ones in.
//
// GET  /api/my/property-files?listingId=X → { files }
// POST /api/my/property-files  multipart form: listingId, file → { file }

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
  const files = await listPropertyFiles(listingId);
  return NextResponse.json({ files });
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  const listingId = String(form.get("listingId") ?? "").trim();
  const file = form.get("file");
  if (!listingId || !(file instanceof File)) {
    return NextResponse.json({ error: "listingId and file are required." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "Keep files under 15MB." }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const saved = await addPropertyFile({
    listingId,
    name: file.name,
    mime: file.type,
    bytes,
    uploaderId: user.id,
    uploaderName: user.name,
  });
  return NextResponse.json({ file: saved });
}
