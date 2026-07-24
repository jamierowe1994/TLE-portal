import { NextRequest, NextResponse } from "next/server";
import { resolveDealAccess } from "@/lib/deal-access";
import { getMailbox } from "@/lib/mailbox-store";
import { sendEmail, type OutgoingAttachment } from "@/lib/mail";
import { logSystemEvent } from "@/lib/deal-store";

// POST /api/deals/:id/email-send — send an email FROM the viewer's connected
// mailbox TO the deal's agent (pre-tenancy only ever emails the agent). Also
// logs an activity line so the send is visible in-portal, not just in email.
// body { subject?, text, attachments?: [{ filename, content(base64) }] }

const MAX_TOTAL_ATTACH_BYTES = 15 * 1024 * 1024;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await resolveDealAccess(req, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const agentEmail = access.deal.managerEmail;
  const agentName = access.deal.managerName || "the agent";
  if (!agentEmail) {
    return NextResponse.json(
      { error: "No email address on file for this deal's agent." },
      { status: 400 }
    );
  }

  const mailbox = await getMailbox(access.user.id);
  if (!mailbox) {
    return NextResponse.json(
      { error: "Connect your email first (under your name, top right)." },
      { status: 400 }
    );
  }

  let body: { subject?: unknown; text?: unknown; attachments?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const text = String(body.text ?? "").trim();
  const subject =
    String(body.subject ?? "").trim() || `${access.deal.app.propertyName} — pre-tenancy`;
  if (!text) {
    return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  }

  // Attachments: [{ filename, content(base64) }], size-capped.
  const attachments: OutgoingAttachment[] = [];
  if (Array.isArray(body.attachments)) {
    let total = 0;
    for (const a of body.attachments) {
      const filename = String((a as { filename?: unknown })?.filename ?? "").trim();
      const content = String((a as { content?: unknown })?.content ?? "");
      if (!filename || !content) continue;
      total += Math.ceil((content.length * 3) / 4);
      if (total > MAX_TOTAL_ATTACH_BYTES) {
        return NextResponse.json({ error: "Attachments are too large (15MB max)." }, { status: 400 });
      }
      attachments.push({ filename, content });
    }
  }

  try {
    await sendEmail(mailbox, { to: agentEmail, subject, text, attachments });
  } catch {
    return NextResponse.json(
      { error: "Couldn't send just now — check your email connection and try again." },
      { status: 502 }
    );
  }

  const attachNote = attachments.length
    ? ` (${attachments.length} attachment${attachments.length === 1 ? "" : "s"})`
    : "";
  await logSystemEvent(
    id,
    { id: access.user.id, name: access.user.name || access.user.email, role: access.role },
    `emailed ${agentName}: "${subject}"${attachNote}`
  );

  return NextResponse.json({
    ok: true,
    email: {
      id: `sent:${Date.now()}`,
      subject,
      from: mailbox.email,
      to: agentEmail,
      date: new Date().toISOString(),
      direction: "out" as const,
      body: text,
    },
  });
}
