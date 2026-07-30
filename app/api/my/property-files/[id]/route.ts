import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { getPropertyFile } from "@/lib/property-files-store";

// Stream one uploaded property file back down, inline where the browser can
// preview it (images, PDFs) and as a download otherwise.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { id } = await params;
  const found = await getPropertyFile(id);
  if (!found) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const inline = /^image\/|^application\/pdf$/.test(found.meta.mime);
  return new NextResponse(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": found.meta.mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${found.meta.name}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
