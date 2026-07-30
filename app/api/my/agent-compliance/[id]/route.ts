import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { isAdminEmail } from "@/lib/brand";
import {
  getAgentComplianceFile,
  deleteAgentCompliance,
} from "@/lib/agent-compliance-store";

// One certificate: streamed back to its owner, or to head office (who need to
// see the copy). Anyone else gets a 404 rather than a hint it exists.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { id } = await params;
  const found = await getAgentComplianceFile(id);
  if (!found) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (found.meta.userId !== user.id && !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const inline = /^image\/|^application\/pdf$/.test(found.meta.mime);
  return new NextResponse(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": found.meta.mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${found.meta.name}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { id } = await params;
  const ok = await deleteAgentCompliance(id, user.id);
  if (!ok) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
