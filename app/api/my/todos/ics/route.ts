import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { listTodos } from "@/lib/todo-store";
import { todoToIcs, icsFilename } from "@/lib/ics";

// GET /api/my/todos/ics?id=... → the to-do as a calendar file.
//
// Scoped to the signed-in agent's own to-dos: listTodos() is already
// per-user, so an id belonging to someone else simply isn't found.

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const todo = (await listTodos(user.id)).find((t) => t.id === id);
  if (!todo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let ics: string | null;
  try {
    ics = todoToIcs(todo);
  } catch {
    return NextResponse.json(
      { error: "That to-do's date can't be read as a date." },
      { status: 400 }
    );
  }
  if (!ics) {
    return NextResponse.json(
      { error: "Give it a date first — a calendar needs one." },
      { status: 400 }
    );
  }

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${icsFilename(todo.note)}"`,
      "Cache-Control": "no-store",
    },
  });
}
