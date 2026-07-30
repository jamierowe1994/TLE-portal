import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { isAdminEmail } from "@/lib/brand";
import { listAllAgentCompliance } from "@/lib/agent-compliance-store";

// Every partner's compliance certificates, for head office. Admin only —
// this is the copy Susan needs to see when an agent uploads one.
//
// GET /api/admin/agent-compliance → { docs }
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return NextResponse.json({ docs: await listAllAgentCompliance() });
}
