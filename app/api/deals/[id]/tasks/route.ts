import { NextRequest, NextResponse } from "next/server";
import { resolveDealAccess } from "@/lib/deal-access";
import { addTask, listTasksForDeal, logSystemEvent } from "@/lib/deal-store";

// Follow-ups on one deal (pre-tenancy Tasks tab).
//   GET  → { tasks }        (pre-tenancy/admin — it's Kirstie's worklist)
//   POST { title, dueDate? } → { task }  and logs an activity line

function fmtDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await resolveDealAccess(req, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  if (access.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ tasks: await listTasksForDeal(id) });
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
  if (access.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { title?: unknown; dueDate?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const title = String(body.title ?? "").trim();
  const rawDue = body.dueDate == null ? null : String(body.dueDate);
  if (!title) {
    return NextResponse.json({ error: "Give the follow-up a title." }, { status: 400 });
  }
  if (rawDue !== null && !/^\d{4}-\d{2}-\d{2}$/.test(rawDue)) {
    return NextResponse.json({ error: "Bad due date." }, { status: 400 });
  }

  const task = await addTask({
    dealId: id,
    dealLabel: access.deal.app.propertyName,
    userId: access.user.id,
    title,
    dueDate: rawDue,
  });
  await logSystemEvent(
    id,
    { id: access.user.id, name: access.user.name || access.user.email, role: access.role },
    `set a follow-up: "${title}"${rawDue ? ` · due ${fmtDue(rawDue)}` : ""}`
  );
  return NextResponse.json({ task });
}
