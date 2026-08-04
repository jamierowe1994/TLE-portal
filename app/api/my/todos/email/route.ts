import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { listTodos } from "@/lib/todo-store";
import { getMailbox } from "@/lib/mailbox-store";
import { sendEmail } from "@/lib/mail";
import { todoToIcs, icsFilename, parseDue } from "@/lib/ics";

// POST /api/my/todos/email { id } → emails the to-do to the agent themselves,
// with the .ics attached so it can be added to the calendar from a phone.
//
// This sends NOW, not later. The portal has no scheduler, and the only SMTP
// identity available is the viewer's own connected mailbox — a background job
// would have neither a session nor a mailbox to send from. The scheduling is
// delegated to the calendar: the attached event carries its own alarms.
//
// Self-send only. `to` is the signed-in user's own address and is never taken
// from the request body, so this can't be turned into a way to mail anyone.

export async function POST(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: { id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (typeof body.id !== "string") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const todo = (await listTodos(user.id)).find((t) => t.id === body.id);
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

  const mailbox = await getMailbox(user.id);
  if (!mailbox) {
    return NextResponse.json(
      {
        error:
          "Connect your email first (under your name, top right) — or use Add to calendar instead.",
      },
      { status: 400 }
    );
  }

  const due = parseDue(todo.dueAt);
  const when = due?.kind === "date" ? due.value : (due?.value.replace("T", " ") ?? "");
  const detail = [
    todo.property ? `Property: ${todo.property}` : null,
    todo.tenant ? `Tenant: ${todo.tenant}` : null,
    todo.platform ? `Platform: ${todo.platform}` : null,
  ].filter(Boolean);

  const text = [
    todo.note,
    "",
    `Due: ${when}`,
    ...detail,
    "",
    "The attached calendar invite will remind you before it's due — open it to add it to your calendar.",
    "",
    "— TLE Portal",
  ].join("\n");

  try {
    await sendEmail(mailbox, {
      to: mailbox.email,
      subject: `Reminder: ${todo.note}`,
      text,
      attachments: [
        {
          filename: icsFilename(todo.note),
          content: Buffer.from(ics, "utf8").toString("base64"),
        },
      ],
    });
  } catch {
    return NextResponse.json(
      { error: "Couldn't send just now — check your email connection and try again." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, sentTo: mailbox.email });
}
