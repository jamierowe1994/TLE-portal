import { NextRequest, NextResponse } from "next/server";
import { resolveDealAccess } from "@/lib/deal-access";
import { getMailbox } from "@/lib/mailbox-store";
import { searchEmails } from "@/lib/mail";

// GET /api/deals/:id/emails — emails between the VIEWER'S connected mailbox
// and this deal's tenants (in + sent, last 90 days, collapsed list).
// { connected:false } when the viewer hasn't linked their email yet.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await resolveDealAccess(req, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const mailbox = await getMailbox(access.user.id);
  if (!mailbox) {
    return NextResponse.json({ connected: false, emails: [] });
  }

  const addresses = access.deal.app.tenants
    .map((t) => t.email)
    .filter((e): e is string => !!e);
  if (addresses.length === 0) {
    return NextResponse.json({ connected: true, emails: [], noAddresses: true });
  }

  try {
    const emails = await searchEmails(mailbox, addresses);
    return NextResponse.json({ connected: true, emails });
  } catch {
    return NextResponse.json(
      {
        connected: true,
        emails: [],
        error:
          "Couldn't reach your mailbox just now — check the connection under your name.",
      },
      { status: 502 }
    );
  }
}
