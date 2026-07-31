import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { resolveRexUserId } from "@/lib/agent-link";
import { getAgentCompliance } from "@/lib/rex-stats";

// The signed-in agent's property compliance, live from REX, worst first.
//
// GET /api/my/compliance → { linked, properties, unchecked, unmapped, error? }
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

  // Same principle one level down: REX can answer for most of the book and cut
  // us off for the rest. Those properties carry checked:false, and the page has
  // to be told about them or an unread property renders as a compliant one.
  const unchecked = properties.filter((p) => !p.checked).length;
  const unmapped = [...new Set(properties.flatMap((p) => p.unmapped))].sort();
  return NextResponse.json({ linked: true, properties, unchecked, unmapped });
}
