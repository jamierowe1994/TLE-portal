import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { resolveRexUserId } from "@/lib/agent-link";
import { getAgentCompliance } from "@/lib/rex-stats";

// The signed-in agent's property compliance, live from REX, worst first.
//
// GET /api/my/compliance → { linked, properties, error? }
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const rexUserId = await resolveRexUserId(user);
  if (!rexUserId) {
    return NextResponse.json({ linked: false, properties: [] });
  }

  const properties = await getAgentCompliance(rexUserId);
  if (properties == null) {
    // Never imply "all clear" when we simply couldn't ask.
    return NextResponse.json({
      linked: true,
      properties: [],
      error: "Couldn't reach REX just now — compliance will be back shortly.",
    });
  }
  return NextResponse.json({ linked: true, properties });
}
