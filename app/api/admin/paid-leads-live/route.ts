import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById, listUsers } from "@/lib/users-store";
import { getBusinessLeadsMTD, metaTokenSet, parseCampaignIds } from "@/lib/meta";

// Live "leads generated this month" for the Paid Leads tab — the only figure
// on that tab Meta can answer directly today. Referrals / MAs booked stay on
// the GoHighLevel snapshot until the TEG system provides them.

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = userId ? await findById(userId) : null;
  if (!admin || !isAdminEmail(admin.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!metaTokenSet()) {
    return NextResponse.json({ configured: false, leads: null });
  }

  // Fallback pool: every campaign tagged on any agent profile.
  const users = await listUsers();
  const campaignIds = [
    ...new Set(users.flatMap((u) => parseCampaignIds(u.metaCampaignId))),
  ];

  const mtd = await getBusinessLeadsMTD(campaignIds).catch(() => null);
  return NextResponse.json({
    configured: true,
    ...(mtd ?? { leads: null }),
    generatedAt: new Date().toISOString(),
  });
}
