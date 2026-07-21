import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { listUserForecasts } from "@/lib/forecast-store";
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
// portfolio, pipeline, compliance items, forecasts) and let Claude answer
// from that context. Answers stream back as plain text.
//
// Needs ANTHROPIC_API_KEY in the environment (.env.local locally, Railway
// variables in production). Without it the route answers 503 and the chat
// shows a setup notice instead of breaking.

const MODEL = "claude-opus-4-8";
const MAX_TURNS = 24; // history cap — the context block carries the real data
const MAX_CHARS = 4000;

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
async function buildAgentContext(userId: string, userName: string, agentKey: string | null) {
  if (!agentKey) {
    return {
      linked: false,
      note: "This account isn't linked to an agent profile yet — no figures are available. Tell them to ask the admin to link their profile.",
    };
  }

  const roster = ROSTER.find((r) => r.agentKey === agentKey) ?? null;
  const funnel = agentSeedStats(agentKey);
  const netIncome = agentNetIncomeYtd(agentKey);
  const complianceSummary = agentCompliance(agentKey);
  const complianceItems = SEED.compliance.sampleItems.filter((item) =>
    nameMatchesAgent(item.manager, agentKey)
  );
  const forecasts = await listUserForecasts(userId).catch(() => []);

  return {
    linked: true,
    agent: {
      name: userName,
      displayName: roster?.displayName ?? userName,
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
    compliance: {
      summary: complianceSummary,
      outstandingItems: complianceItems,
      note: "outstandingItems is the worst-first sample from the compliance report — the summary counts are the authoritative totals.",
    },
    forecasts: forecasts.map((f) => ({
      month: f.month,
      gciTarget: f.gciTarget,
      portfolioTarget: f.portfolioTarget,
      moveInsTarget: f.moveInsTarget,
      maTarget: f.maTarget,
      notes: f.notes ?? null,
    })),
  };
}

function systemPrompt(today: string): string {
  return `You are the TLE Assistant — the built-in helper inside The Lettings Expert partner portal. You're talking to one of TLE's letting agents (a partner) about THEIR business. Their data is provided in the next system block as JSON.

Today's date: ${today}. Most figures come from the TLE Business Dashboard snapshot captured ${SNAPSHOT_DATE}; a "source" field of "live-rex" or "live-meta" means the figure is live.

How to answer:
- Answer only from the provided data. If something isn't in it, say so plainly and point them to the right tab (My Properties, Applications, Compliance, My Ads, Forecast) or to head office — never invent figures.
- Money is GBP: format as £1,234. Percentages as whole numbers.
- Be warm, direct and brief — a couple of short sentences or a short list is usually right. This is a busy letting agent, not a report reader.
- When asked "what do I need to do today/next", lead with overdue compliance items (worst first), then pipeline properties awaiting action, then this month's targets vs progress.
- When comparing months, use earningsByMonth2026. July's earned figure isn't in yet — say so if they ask about July earnings, and offer the forecast target instead.
- Plain text only — no markdown headings, no bold, no tables. Simple hyphen lists are fine.
- You can't take actions (no emails, no edits, no bookings) — you only inform. If asked to do something, explain what to do and where.`;
}

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
  const messages = rawMessages
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const context = await buildAgentContext(user.id, user.name, user.agentKey);
  const today = new Date().toISOString().slice(0, 10);

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 1500,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: [
      { type: "text", text: systemPrompt(today) },
      {
        type: "text",
        text: `The signed-in agent's data:\n${JSON.stringify(context)}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
