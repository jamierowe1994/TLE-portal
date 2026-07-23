import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById, listUsers } from "@/lib/users-store";
import { getBusinessLeadsMTD, metaTokenSet, parseCampaignIds } from "@/lib/meta";
import { getGhlPaidLeadsMtd } from "@/lib/ghl";
import { currentMonth } from "@/lib/format";

// Live figures for the Paid Leads tab, from both ends of the funnel:
//   Meta — leads generated + spend + CPL (the ads platform's own numbers).
//   GHL  — the CRM funnel: leads created, referred to agents (Initial Call
//          Booked), MAs booked (MA Booked stage / won). Cached in lib/ghl.ts.

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = userId ? await findById(userId) : null;
  if (!admin || !isAdminEmail(admin.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const month = currentMonth();

  const metaWork = (async () => {
    if (!metaTokenSet()) return null;
    // Fallback pool: every campaign tagged on any agent profile.
    const users = await listUsers();
    const campaignIds = [
      ...new Set(users.flatMap((u) => parseCampaignIds(u.metaCampaignId))),
    ];
    return getBusinessLeadsMTD(campaignIds).catch(() => null);
  })();

  const [mtd, ghl] = await Promise.all([
    metaWork,
    getGhlPaidLeadsMtd(month).catch(() => null),
  ]);

  return NextResponse.json({
    configured: metaTokenSet(),
    ...(mtd ?? { leads: null }),
    ghl,
    generatedAt: new Date().toISOString(),
  });
}
