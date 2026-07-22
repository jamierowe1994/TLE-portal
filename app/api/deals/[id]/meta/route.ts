import { NextRequest, NextResponse } from "next/server";
import { resolveDealAccess } from "@/lib/deal-access";
import {
  effectiveStatusKey,
  logSystemEvent,
  setChecklistItem,
  setStageOverride,
} from "@/lib/deal-store";
import { CHECKLIST_ITEMS, PROPOLY_STAGE_BY_KEY } from "@/lib/propoly-stages";

// Pre-tenancy actions on one deal — Kirstie (or an admin) only:
//   POST { stage: "references" }        move the deal's displayed stage
//   POST { stage: null }                hand it back to the live Propoly status
//   POST { checklist: { key, done } }   tick/untick a checklist item
// Agents see the results in their drawer but can't move stages or tick items.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await resolveDealAccess(req, id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  if (access.role === "agent") {
    return NextResponse.json(
      { error: "Only the pre-tenancy team can move stages or tick the checklist." },
      { status: 403 }
    );
  }

  let body: { stage?: unknown; checklist?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const byName = access.user.name || access.user.email;

  if ("stage" in body) {
    const stage = body.stage;
    if (stage !== null && (typeof stage !== "string" || !PROPOLY_STAGE_BY_KEY[stage])) {
      return NextResponse.json({ error: "Unknown stage." }, { status: 400 });
    }
    const meta = await setStageOverride(
      id,
      stage as string | null,
      access.deal.statusKey,
      byName
    );
    const actor = { id: access.user.id, name: byName, role: access.role };
    if (stage === null) {
      await logSystemEvent(id, actor, "reset the stage to Propoly's live status");
    } else {
      const label = PROPOLY_STAGE_BY_KEY[stage as string]?.label ?? stage;
      await logSystemEvent(id, actor, `moved the deal to ${label}`);
    }
    return NextResponse.json({
      meta,
      statusKey: access.deal.statusKey,
      effectiveStatusKey: effectiveStatusKey(access.deal.statusKey, meta),
    });
  }

  if (body.checklist && typeof body.checklist === "object") {
    const { key, done } = body.checklist as { key?: unknown; done?: unknown };
    if (typeof key !== "string" || !CHECKLIST_ITEMS.some((i) => i.key === key)) {
      return NextResponse.json({ error: "Unknown checklist item." }, { status: 400 });
    }
    const meta = await setChecklistItem(id, key, done === true, byName);
    const item = CHECKLIST_ITEMS.find((i) => i.key === key)!;
    await logSystemEvent(
      id,
      { id: access.user.id, name: byName, role: access.role },
      `${done === true ? "ticked" : "unticked"} "${item.label}" on the checklist`
    );
    return NextResponse.json({
      meta,
      statusKey: access.deal.statusKey,
      effectiveStatusKey: effectiveStatusKey(access.deal.statusKey, meta),
    });
  }

  return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
}
