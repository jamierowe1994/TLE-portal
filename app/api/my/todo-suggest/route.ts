import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { resolveRexUserId } from "@/lib/agent-link";
import { getAgentListings } from "@/lib/rex-stats";
import { getPropolyAgentDeals } from "@/lib/propoly-deals";

// Autocomplete for the To-dos form: the agent's OWN properties and tenants,
// pulled from what the portal already knows — Propoly deals first, then
// their REX listings. Free text is always allowed; this just saves typing
// and keeps names consistent.
//
// GET /api/my/todo-suggest?kind=property|tenant&q=marine
//   → { suggestions: [{ label, sub }] }

interface Suggestion {
  label: string;
  sub: string | null;
}

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const kind = req.nextUrl.searchParams.get("kind") === "tenant" ? "tenant" : "property";
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();

  // Both sources are cached in their own modules (60s), so this stays quick.
  const [deals, rexUserId] = await Promise.all([
    getPropolyAgentDeals({ email: user.email, agentKey: user.agentKey ?? null }).catch(
      () => null
    ),
    resolveRexUserId(user).catch(() => null),
  ]);
  const listings = rexUserId
    ? await getAgentListings(rexUserId).catch(() => null)
    : null;

  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (label: string | null, sub: string | null) => {
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, sub });
  };

  if (kind === "property") {
    // Propoly (live deals) first — most likely what they're chasing.
    for (const d of deals ?? []) {
      if (d.stage === "unsuccessful") continue;
      push(d.propertyName, d.locality || null);
    }
    // Then everything they have on REX (their managed/marketed book).
    for (const l of listings ?? []) {
      push(l.name, l.locality || null);
    }
  } else {
    for (const d of deals ?? []) {
      if (d.stage === "unsuccessful") continue;
      for (const t of d.tenants) {
        push(t.name, d.propertyName);
      }
    }
  }

  const filtered = q
    ? out.filter(
        (s) =>
          s.label.toLowerCase().includes(q) || (s.sub ?? "").toLowerCase().includes(q)
      )
    : out;

  return NextResponse.json({ suggestions: filtered.slice(0, 8) });
}
