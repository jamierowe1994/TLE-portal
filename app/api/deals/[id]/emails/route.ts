import { NextRequest, NextResponse } from "next/server";
import { resolveDealAccess } from "@/lib/deal-access";
import { getMailbox } from "@/lib/mailbox-store";
import { searchEmails } from "@/lib/mail";

// GET /api/deals/:id/emails — the viewer's email correspondence with this
// deal's AGENT (pre-tenancy never emails tenants directly). Rendered as a
// chat log. { connected:false } when the viewer hasn't linked their email.
// Returns the agent's name/email so the tab can title "Emailing {agent}".

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await resolveDealAccess(req, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const agentEmail = access.deal.managerEmail;
  const agentName = access.deal.managerName;

  const mailbox = await getMailbox(access.user.id);
  if (!mailbox) {
    return NextResponse.json({ connected: false, emails: [], agentEmail, agentName });
  }
  if (!agentEmail) {
    return NextResponse.json({ connected: true, emails: [], noAgentEmail: true, agentName });
  }

  try {
    const emails = await searchEmails(mailbox, [agentEmail]);
    return NextResponse.json({ connected: true, emails, agentEmail, agentName });
  } catch {
    return NextResponse.json(
      {
        connected: true,
        emails: [],
        agentEmail,
        agentName,
        error:
          "Couldn't reach your mailbox just now — check the connection under your name.",
      },
      { status: 502 }
    );
  }
}
