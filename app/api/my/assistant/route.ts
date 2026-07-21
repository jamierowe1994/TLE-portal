import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById, type StoredUser } from "@/lib/users-store";
import { listUserForecasts } from "@/lib/forecast-store";
import { listKnowledge } from "@/lib/knowledge-store";
import { listTodos, createTodo, updateTodo } from "@/lib/todo-store";
import { getPropolyAgentDeals } from "@/lib/propoly-deals";
import { getAgentCompliance } from "@/lib/rex-stats";
import { getAgentMetaStats } from "@/lib/meta";
import { resolveRexUserId } from "@/lib/agent-link";
import { nameMatchesAgent, ROSTER } from "@/lib/roster";
import {
  agentSeedStats,
  agentMoveIns,
  agentPipeline,
  agentCompliance,
  agentNetIncomeYtd,
  agentPortfolio,
  SEED,
  SNAPSHOT_DATE,
} from "@/lib/seed-data";
import type { StatValue } from "@/lib/types";

// POST /api/my/assistant — the partner's all-in-one Q&A agent, backed by
// Claude. The client sends the visible chat history; we assemble everything
// the portal knows about the signed-in agent server-side (funnel, earnings,
// portfolio, live progression, live compliance, paid ads, reminders,
// forecasts, plus Susan's knowledge library) and let Claude answer from
// that context. Claude can also manage the agent's To-dos list through two
// tools (create_reminder / update_reminder) — the only actions it can take.
// Answers stream back as plain text.
//
// Needs ANTHROPIC_API_KEY in the environment (.env.local locally, Railway
// variables in production). Without it the route answers 503 and the chat
// shows a setup notice instead of breaking.

const MODEL = "claude-opus-4-8";
const MAX_TURNS = 24; // history cap — the context block carries the real data
const MAX_CHARS = 4000;
const MAX_TOOL_ROUNDS = 4; // reminder edits per question — plenty, and bounded

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

function isChatTurn(t: unknown): t is ChatTurn {
  if (typeof t !== "object" || t === null) return false;
  const turn = t as Record<string, unknown>;
  return (
    (turn.role === "user" || turn.role === "assistant") &&
    typeof turn.content === "string" &&
    turn.content.length > 0
  );
}

/** Flatten a StatValue to something small the model can read. */
function lite(s: StatValue | undefined | null) {
  if (!s) return null;
  return { value: s.value, source: s.source };
}

/** Everything the portal knows about this agent, as one JSON block. */
async function buildAgentContext(user: StoredUser) {
  const agentKey = user.agentKey ?? null;

  // Live layers — each degrades to null alone, never blocks the answer.
  const rexUserId = await resolveRexUserId(user).catch(() => null);
  const [progression, liveCompliance, meta, todos] = await Promise.all([
    getPropolyAgentDeals({ email: user.email, agentKey }).catch(() => null),
    rexUserId ? getAgentCompliance(rexUserId).catch(() => null) : Promise.resolve(null),
    getAgentMetaStats(user).catch(() => ({ configured: false as const })),
    listTodos(user.id).catch(() => []),
  ]);

  const tenancyProgression = progression
    ? {
        note: "LIVE from Propoly (tenancy progression) — the agent's deals moving toward move-in, nearest completion first.",
        deals: progression
          .filter((a) => a.stage !== "unsuccessful")
          .slice(0, 40)
          .map((a) => ({
            status: a.status,
            property: a.propertyName,
            locality: a.locality,
            rentPcm: a.offer,
            expectedMoveIn: a.startDate,
            tenants: a.tenants.map((t) => t.name),
          })),
      }
    : null;

  const complianceLive = liveCompliance
    ? {
        note: "LIVE from REX PM — the agent's properties with compliance outstanding (expired, expiring within 60 days, or missing).",
        properties: liveCompliance
          .filter((p) => p.outstanding > 0)
          .slice(0, 25)
          .map((p) => ({
            property: p.name,
            locality: p.locality,
            outstanding: p.outstanding,
            items: p.items
              .filter((i) => i.state === "expired" || i.state === "expiring" || i.state === "missing")
              .map((i) => ({ certificate: i.label, state: i.state, expiry: i.expiry })),
          })),
      }
    : null;

  const paidAds =
    meta.configured && "snapshot" in meta && meta.snapshot
      ? { note: "LIVE from Meta — the agent's ad campaigns, last 30 days.", ...meta.snapshot }
      : null;

  const reminders = {
    note: "The agent's To-dos list (their reminders — you can manage these with your tools). Open items only; ids are what update_reminder takes.",
    open: todos
      .filter((t) => !t.done)
      .slice(0, 50)
      .map((t) => ({
        id: t.id,
        note: t.note,
        dueAt: t.dueAt,
        platform: t.platform,
        property: t.property,
        tenant: t.tenant,
      })),
    doneCount: todos.filter((t) => t.done).length,
  };

  if (!agentKey) {
    return {
      linked: false,
      note: "This account isn't linked to an agent profile yet — snapshot figures are unavailable. Tell them to ask the admin to link their profile.",
      tenancyProgression,
      complianceLive,
      paidAds,
      reminders,
    };
  }

  const roster = ROSTER.find((r) => r.agentKey === agentKey) ?? null;
  const funnel = agentSeedStats(agentKey);
  const netIncome = agentNetIncomeYtd(agentKey);
  const complianceSummary = agentCompliance(agentKey);
  const complianceItems = SEED.compliance.sampleItems.filter((item) =>
    nameMatchesAgent(item.manager, agentKey)
  );
  const forecasts = await listUserForecasts(user.id).catch(() => []);

  return {
    linked: true,
    agent: {
      name: user.name,
      displayName: roster?.displayName ?? user.name,
      region: roster?.region ?? null,
      partnerType: roster?.partnerType ?? null,
    },
    thisMonthFunnel: {
      marketAppraisals: lite(funnel.marketAppraisals),
      listings: lite(funnel.listings),
      viewings: lite(funnel.viewings),
      applications: lite(funnel.applications),
      moveIns: lite(funnel.moveIns),
      pipeline: lite(funnel.pipeline),
      gci: lite(funnel.gci),
    },
    earningsByMonth2026: netIncome
      ? {
          jan: netIncome.jan,
          feb: netIncome.feb,
          mar: netIncome.mar,
          apr: netIncome.apr,
          may: netIncome.may,
          jun: netIncome.jun,
          ytdTotal: netIncome.ytdTotal,
          note: "Partner net income exc VAT, £. July lands at month-end.",
        }
      : null,
    portfolio: agentPortfolio(agentKey),
    moveInsThisMonth: agentMoveIns(agentKey),
    forwardPipeline: agentPipeline(agentKey),
    complianceSnapshot: {
      summary: complianceSummary,
      outstandingItems: complianceItems,
      note: `Snapshot from ${SNAPSHOT_DATE} — prefer complianceLive when present; it's today's truth.`,
    },
    complianceLive,
    tenancyProgression,
    paidAds,
    forecasts: forecasts.map((f) => ({
      month: f.month,
      gciTarget: f.gciTarget,
      portfolioTarget: f.portfolioTarget,
      moveInsTarget: f.moveInsTarget,
      maTarget: f.maTarget,
      notes: f.notes ?? null,
    })),
    reminders,
  };
}

function systemPrompt(today: string): string {
  return `You are the TLE Assistant — the built-in helper inside The Lettings Expert partner portal. You're talking to one of TLE's letting agents (a partner) about THEIR business. Their data is provided in a later system block as JSON.

Today's date: ${today}. Blocks marked LIVE are real-time; anything sourced "snapshot" is from the TLE Business Dashboard capture of ${SNAPSHOT_DATE}.

How to answer:
- Answer only from the provided data. If something isn't in it, say so plainly and point them to the right tab (To-dos, My Properties, Applications, Compliance, My Ads, Forecast) or to head office — never invent figures.
- Money is GBP: format as £1,234. Percentages as whole numbers.
- Be warm, direct and brief — a couple of short sentences or a short list is usually right. This is a busy letting agent, not a report reader.
- When asked "what do I need to do today/next", combine and prioritise: overdue compliance (complianceLive first, worst first), overdue or dated reminders from their To-dos, deals in tenancyProgression closest to move-in (signing & move-in monies, then tenancy generation, then references), then this month's targets vs progress.
- When comparing months, use earningsByMonth2026. July's earned figure isn't in yet — say so if they ask about July earnings, and offer the forecast target instead.
- Plain text only — no markdown headings, no bold, no tables. Simple hyphen lists are fine.

Reminders — the one thing you can DO, not just say:
- You have two tools: create_reminder and update_reminder. They edit the agent's To-dos page in real time.
- When the agent mentions something they need to do, offer to add it (or just add it if they've clearly asked). Include dueAt / platform / property / tenant when they're known — don't interrogate for them.
- When they say something's been handled, offer to mark the matching reminder done (match by note/property; ids are in reminders.open).
- Never claim a reminder was created, updated or completed unless the tool actually ran. After a tool runs, confirm in one short sentence what changed.
- Anything beyond reminders (emails, bookings, edits in REX/Propoly/PayProp) you cannot do — explain what to do and where instead.
- A "Head office knowledge" block may also be present — guidance TLE head office curated for you (fees, processes, policies). Treat it as authoritative for policy/process questions and mention which entry you're drawing on. For numbers, the agent's own data block always wins.`;
}

/** Susan's briefing library, as one capped text block (oldest dropped first). */
async function knowledgeBlock(): Promise<string | null> {
  const MAX_TOTAL = 60_000;
  const entries = await listKnowledge().catch(() => []);
  if (entries.length === 0) return null;
  const parts: string[] = [];
  let used = 0;
  for (const e of entries) {
    const text = `### ${e.title} (updated ${e.updatedAt.slice(0, 10)})\n${e.content}`;
    if (used + text.length > MAX_TOTAL) break;
    parts.push(text);
    used += text.length;
  }
  if (parts.length === 0) return null;
  return `Head office knowledge (curated by TLE head office for you):\n\n${parts.join("\n\n---\n\n")}`;
}

/* ------------------------------------------------------------------------ */
/* Reminder tools                                                            */
/* ------------------------------------------------------------------------ */

const TOOLS: Anthropic.Tool[] = [
  {
    name: "create_reminder",
    description:
      "Add a to-do to the agent's To-dos page. Use when the agent asks to be reminded of something, or agrees to track an action you've discussed.",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string", description: "What needs doing, phrased for the agent" },
        dueAt: {
          type: "string",
          description: "Optional due date or date-time, ISO 8601 (2026-07-25 or 2026-07-25T14:00)",
        },
        platform: {
          type: "string",
          description: "Optional platform the task happens on: REX, REX PM, PayProp, Propoly, InventoryBase or Flatfair",
        },
        property: { type: "string", description: "Optional property it relates to" },
        tenant: { type: "string", description: "Optional tenant it relates to" },
      },
      required: ["note"],
    },
  },
  {
    name: "update_reminder",
    description:
      "Update one of the agent's existing to-dos by id (ids are in reminders.open in your context): edit its fields, or set done true/false to tick it off / reopen it.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The reminder's id from reminders.open" },
        note: { type: "string" },
        dueAt: { type: "string" },
        platform: { type: "string" },
        property: { type: "string" },
        tenant: { type: "string" },
        done: { type: "boolean" },
      },
      required: ["id"],
    },
  },
];

async function runReminderTool(
  userId: string,
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    if (name === "create_reminder") {
      const todo = await createTodo(userId, {
        note: String(input.note ?? ""),
        dueAt: typeof input.dueAt === "string" ? input.dueAt : null,
        platform: typeof input.platform === "string" ? input.platform : null,
        property: typeof input.property === "string" ? input.property : null,
        tenant: typeof input.tenant === "string" ? input.tenant : null,
      });
      return JSON.stringify({ ok: true, created: todo });
    }
    if (name === "update_reminder") {
      const todo = await updateTodo(userId, String(input.id ?? ""), {
        note: typeof input.note === "string" ? input.note : undefined,
        dueAt: typeof input.dueAt === "string" ? input.dueAt : undefined,
        platform: typeof input.platform === "string" ? input.platform : undefined,
        property: typeof input.property === "string" ? input.property : undefined,
        tenant: typeof input.tenant === "string" ? input.tenant : undefined,
        done: typeof input.done === "boolean" ? input.done : undefined,
      });
      return todo
        ? JSON.stringify({ ok: true, updated: todo })
        : JSON.stringify({ ok: false, error: "No reminder with that id" });
    }
    return JSON.stringify({ ok: false, error: `Unknown tool ${name}` });
  } catch (e) {
    return JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : "Tool failed",
    });
  }
}

/* ------------------------------------------------------------------------ */
/* Route                                                                     */
/* ------------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const user = await findById(userId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error: "not_configured",
        message:
          "The assistant isn't connected yet — add ANTHROPIC_API_KEY to the environment to switch it on.",
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const rawMessages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(rawMessages) || !rawMessages.every(isChatTurn)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const history = rawMessages
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const [context, knowledge] = await Promise.all([
    buildAgentContext(user),
    knowledgeBlock(),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: systemPrompt(today) },
    // Knowledge is shared across every agent — its own cache breakpoint so
    // the per-agent block after it doesn't invalidate it.
    ...(knowledge
      ? [{ type: "text" as const, text: knowledge, cache_control: { type: "ephemeral" as const } }]
      : []),
    {
      type: "text",
      text: `The signed-in agent's data:\n${JSON.stringify(context)}`,
      cache_control: { type: "ephemeral" },
    },
  ];

  const client = new Anthropic();
  const encoder = new TextEncoder();

  // Agentic loop: stream text out as it arrives; when Claude calls a
  // reminder tool, run it, feed the result back, and keep streaming the
  // follow-up text on the same response. Bounded by MAX_TOOL_ROUNDS.
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let convo: Anthropic.MessageParam[] = [...history];
        for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
          const stream = client.messages.stream({
            model: MODEL,
            max_tokens: 1500,
            thinking: { type: "adaptive" },
            output_config: { effort: "medium" },
            system,
            tools: TOOLS,
            messages: convo,
          });

          let emittedThisRound = false;
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
              emittedThisRound = true;
            }
          }

          const final = await stream.finalMessage();
          if (final.stop_reason !== "tool_use" || round === MAX_TOOL_ROUNDS) break;

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of final.content) {
            if (block.type === "tool_use") {
              const result = await runReminderTool(
                user.id,
                block.name,
                (block.input ?? {}) as Record<string, unknown>
              );
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result,
              });
            }
          }
          convo = [
            ...convo,
            { role: "assistant", content: final.content },
            { role: "user", content: toolResults },
          ];
          // Keep pre-tool and post-tool prose from running together.
          if (emittedThisRound) controller.enqueue(encoder.encode("\n"));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
