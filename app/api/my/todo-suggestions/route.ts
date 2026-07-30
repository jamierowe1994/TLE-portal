import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { resolveRexUserId } from "@/lib/agent-link";
import { listTodos } from "@/lib/todo-store";
import { getAgentCompliance, getAgentListings } from "@/lib/rex-stats";

// GET /api/my/todo-suggestions → { suggestions: [{ note, property?, why }] }
//
// Reads what's actually outstanding across the agent's compliance and
// properties, subtracts what's already on their list, and asks Claude to
// turn the rest into a handful of concrete next actions. Suggestions are
// returned for the agent to accept — nothing is written here.

const MODEL = "claude-opus-4-8";

interface Suggestion {
  note: string;
  property?: string | null;
  why?: string | null;
}

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Suggestions aren't switched on yet — the assistant needs its API key." },
      { status: 503 }
    );
  }

  const rexUserId = await resolveRexUserId(user);
  const [compliance, listings, todos] = await Promise.all([
    rexUserId ? getAgentCompliance(rexUserId) : Promise.resolve(null),
    rexUserId ? getAgentListings(rexUserId) : Promise.resolve(null),
    listTodos(user.id),
  ]);

  // Only what needs a human — the model doesn't need the whole book.
  const outstanding = (compliance ?? [])
    .filter((p) => p.outstanding > 0)
    .slice(0, 25)
    .map((p) => ({
      property: p.name,
      items: p.items
        .filter((i) => ["expired", "expiring", "missing"].includes(i.state))
        .map((i) => `${i.label} (${i.state}${i.expiry ? `, ${i.expiry}` : ""})`),
    }));

  const drafts = (listings ?? [])
    .filter((l) => (l.publicationStatus ?? "").toLowerCase().includes("draft"))
    .slice(0, 15)
    .map((l) => ({
      property: l.name,
      missingPhotos: l.imageCount === 0,
    }));

  const openTodos = todos.filter((t) => !t.done).map((t) => t.note);

  if (outstanding.length === 0 && drafts.length === 0) {
    return NextResponse.json({ suggestions: [] });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `You are helping a UK lettings agent decide what to do next.

OUTSTANDING COMPLIANCE (property → items needing action):
${JSON.stringify(outstanding, null, 1)}

DRAFT LISTINGS NOT YET LIVE:
${JSON.stringify(drafts, null, 1)}

ALREADY ON THEIR TO-DO LIST (do not repeat these):
${JSON.stringify(openTodos, null, 1)}

Suggest up to 5 concrete next actions, most urgent first. Rules:
- One action per suggestion, phrased as the agent would write it, e.g.
  "Chase EPC booking for Flat 3, 15 Marine Parade".
- Never duplicate something already on their list.
- Prefer expired/missing certificates over expiring ones, and expiring
  over draft listings.
- Use British English.

Reply with ONLY a JSON array, no prose:
[{"note": "...", "property": "...", "why": "one short clause"}]`;

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 900,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    // The model is asked for bare JSON; tolerate a code fence anyway.
    const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
    const parsed = JSON.parse(json) as Suggestion[];
    const suggestions = parsed
      .filter((s) => s && typeof s.note === "string" && s.note.trim())
      .slice(0, 5)
      .map((s) => ({
        note: s.note.trim(),
        property: typeof s.property === "string" ? s.property : null,
        why: typeof s.why === "string" ? s.why : null,
      }));
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json(
      { error: "Couldn't put suggestions together just now." },
      { status: 502 }
    );
  }
}
