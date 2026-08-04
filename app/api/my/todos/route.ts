import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { listTodos, createTodo, updateTodo, deleteTodo } from "@/lib/todo-store";

// The signed-in agent's to-dos — used by the To-dos page and kept in sync
// with what the TLE Assistant creates/completes mid-conversation.
//   GET    /api/my/todos             → { todos }
//   POST   /api/my/todos             { note, dueAt?, platform?, property?, tenant? } → { todo }
//   PATCH  /api/my/todos             { id, ...fields, done? } → { todo }
//   DELETE /api/my/todos?id=...      → { deleted }

async function requireUser(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorised" }, { status: 401 }) };
  }
  return { user };
}

export async function GET(req: NextRequest) {
  const gate = await requireUser(req);
  if (gate.error) return gate.error;
  return NextResponse.json({ todos: await listTodos(gate.user.id) });
}

export async function POST(req: NextRequest) {
  const gate = await requireUser(req);
  if (gate.error) return gate.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (typeof body.note !== "string" || !body.note.trim()) {
    return NextResponse.json({ error: "A to-do needs a note." }, { status: 400 });
  }
  try {
    const todo = await createTodo(gate.user.id, {
      note: body.note,
      dueAt: typeof body.dueAt === "string" ? body.dueAt : null,
      platform: typeof body.platform === "string" ? body.platform : null,
      property: typeof body.property === "string" ? body.property : null,
      tenant: typeof body.tenant === "string" ? body.tenant : null,
    });
    return NextResponse.json({ todo });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Couldn't save that." },
      { status: 400 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requireUser(req);
  if (gate.error) return gate.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (typeof body.id !== "string") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  // updateTodo rejects a dueAt that isn't a date — a 400, not a 500.
  try {
    const todo = await updateTodo(gate.user.id, body.id, {
      note: typeof body.note === "string" ? body.note : undefined,
      dueAt: body.dueAt === null || typeof body.dueAt === "string" ? (body.dueAt as string | null) : undefined,
      platform: body.platform === null || typeof body.platform === "string" ? (body.platform as string | null) : undefined,
      property: body.property === null || typeof body.property === "string" ? (body.property as string | null) : undefined,
      tenant: body.tenant === null || typeof body.tenant === "string" ? (body.tenant as string | null) : undefined,
      done: typeof body.done === "boolean" ? body.done : undefined,
    });
    if (!todo) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ todo });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Couldn't save that." },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireUser(req);
  if (gate.error) return gate.error;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  return NextResponse.json({ deleted: await deleteTodo(gate.user.id, id) });
}
