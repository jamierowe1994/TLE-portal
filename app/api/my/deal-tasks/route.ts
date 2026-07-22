import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { listTasksForUser, setTaskDone } from "@/lib/deal-store";

// The signed-in user's own follow-ups across every deal.
//   GET  ?due=YYYY-MM-DD → { tasks }   (powers the "Tasks today" button)
//   PATCH { id, done }   → { task }    (owner only — enforced in the store)

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const due = req.nextUrl.searchParams.get("due");
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    return NextResponse.json({ error: "Bad due date." }, { status: 400 });
  }
  return NextResponse.json({ tasks: await listTasksForUser(user.id, due ?? undefined) });
}

export async function PATCH(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: { id?: unknown; done?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Which task?" }, { status: 400 });

  const task = await setTaskDone(id, user.id, body.done === true);
  if (!task) {
    return NextResponse.json({ error: "Couldn't find that task." }, { status: 404 });
  }
  return NextResponse.json({ task });
}
