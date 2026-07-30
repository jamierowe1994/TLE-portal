import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { createTodo } from "@/lib/todo-store";
import {
  addAgentCompliance,
  listAgentCompliance,
  AGENT_COMPLIANCE_TYPES,
  MAX_AGENT_DOC_BYTES,
  type AgentComplianceType,
} from "@/lib/agent-compliance-store";

// The signed-in partner's own compliance certificates.
//
// GET  /api/my/agent-compliance → { docs }
// POST /api/my/agent-compliance  multipart: file, type, label?, expiry?, remind?
//
// Uploading optionally drops a renewal reminder onto their To-dos a month
// before the expiry they gave, since these all run annually.

async function requireUser(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  return userId ? await findById(userId) : null;
}

export async function GET(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  return NextResponse.json({ docs: await listAgentCompliance(user.id) });
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

  const file = form.get("file");
  const type = String(form.get("type") ?? "").trim() as AgentComplianceType;
  const known = AGENT_COMPLIANCE_TYPES.find((t) => t.key === type);
  if (!(file instanceof File) || !known) {
    return NextResponse.json({ error: "Pick a document and its type." }, { status: 400 });
  }
  if (file.size > MAX_AGENT_DOC_BYTES) {
    return NextResponse.json({ error: "Keep files under 15MB." }, { status: 413 });
  }

  const expiryRaw = String(form.get("expiry") ?? "").trim();
  const expiry = /^\d{4}-\d{2}-\d{2}$/.test(expiryRaw) ? expiryRaw : null;
  const label = String(form.get("label") ?? "").trim() || known.label;

  const doc = await addAgentCompliance({
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    type,
    label,
    name: file.name,
    mime: file.type,
    bytes: Buffer.from(await file.arrayBuffer()),
    expiry,
  });

  // A month's notice, so there's time to actually renew it.
  let reminded = false;
  if (expiry && String(form.get("remind") ?? "") === "true") {
    const due = new Date(expiry);
    due.setMonth(due.getMonth() - 1);
    if (due.getTime() > Date.now()) {
      await createTodo(user.id, {
        note: `Renew your ${label.toLowerCase()} — it expires ${expiry}`,
        dueAt: due.toISOString(),
      }).catch(() => null);
      reminded = true;
    }
  }

  return NextResponse.json({ doc, reminded });
}
