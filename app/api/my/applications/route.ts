import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { resolveRexUserId } from "@/lib/agent-link";
import { getAgentApplications } from "@/lib/rex-stats";
import { getPropolyAgentDeals } from "@/lib/propoly-deals";

// The signed-in agent's let pipeline. Propoly (tenancy progression) is the
// primary source — it's the system actually running referencing and
// agreements, and deals match the agent via their property manager email.
// REX tenancy applications remain the fallback when Propoly isn't
// configured or can't be reached.
//
// GET /api/my/applications → { linked, applications, source?, error? }
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const propoly = await getPropolyAgentDeals({
    email: user.email,
    agentKey: user.agentKey ?? null,
  }).catch(() => null);
  if (propoly != null) {
    return NextResponse.json({
      linked: true,
      applications: propoly,
      source: "propoly",
    });
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
  return NextResponse.json({ linked: true, applications, source: "rex" });
}
