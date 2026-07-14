import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { resolveRexUserId } from "@/lib/agent-link";
import { getAgentApplications } from "@/lib/rex-stats";

// The signed-in agent's tenancy applications — their let pipeline, live from REX.
//
// GET /api/my/applications → { linked, applications, error? }
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const rexUserId = await resolveRexUserId(user);
  if (!rexUserId) {
    return NextResponse.json({ linked: false, applications: [] });
  }

  const applications = await getAgentApplications(rexUserId);
  if (applications == null) {
    // Never imply an empty pipeline when we simply couldn't ask.
    return NextResponse.json({
      linked: true,
      applications: [],
      error: "Couldn't reach REX just now — your pipeline will be back shortly.",
    });
  }
  return NextResponse.json({ linked: true, applications });
}
