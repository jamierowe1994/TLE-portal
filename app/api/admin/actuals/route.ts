import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, isAdminEmail, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import {
  getOverrides,
  upsertOverride,
  deleteOverride,
} from "@/lib/actuals-store";
import { currentMonth } from "@/lib/format";

// Admin manual overrides of actual figures (the "manual" rung of the
// live → manual → snapshot resolveStat chain).
// GET    ?month=2026-07                                    → { month, overrides }
// PUT    { scope, agentKey?, month, metric, value, note? } → { override }
// DELETE ?id=business::2026-07:income.combinedGci          → { deleted }
// Metric dot-keys are documented in lib/actuals-store.ts.

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const user = await findById(userId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!isAdminEmail(user.email)) {
    return NextResponse.json(
      { error: "This area is locked to the business owner." },
      { status: 403 }
    );
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const monthParam = req.nextUrl.searchParams.get("month");
  const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : currentMonth();
  const overrides = await getOverrides(month);
  return NextResponse.json({ month, overrides });
}

export async function PUT(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const scope = body.scope;
  if (scope !== "business" && scope !== "agent") {
    return NextResponse.json(
      { error: 'scope must be "business" or "agent".' },
      { status: 400 }
    );
  }

  const agentKey =
    typeof body.agentKey === "string" && body.agentKey.trim()
      ? body.agentKey.trim()
      : undefined;
  if (scope === "agent" && !agentKey) {
    return NextResponse.json(
      { error: "agentKey is required when scope is \"agent\"." },
      { status: 400 }
    );
  }

  const month = typeof body.month === "string" ? body.month : "";
  if (!MONTH_RE.test(month)) {
    return NextResponse.json(
      { error: 'month must look like "2026-07".' },
      { status: 400 }
    );
  }

  const metric = typeof body.metric === "string" ? body.metric.trim() : "";
  if (!metric || metric.length > 120) {
    return NextResponse.json(
      { error: 'metric is required — a dot-key like "income.combinedGci".' },
      { status: 400 }
    );
  }

  const value = typeof body.value === "number" ? body.value : Number(body.value);
  if (body.value == null || body.value === "" || !Number.isFinite(value)) {
    return NextResponse.json(
      { error: "value must be a finite number." },
      { status: 400 }
    );
  }

  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim().slice(0, 500)
      : undefined;

  const override = await upsertOverride({
    scope,
    agentKey,
    month,
    metric,
    value,
    note,
  });
  return NextResponse.json({ override });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param required." }, { status: 400 });
  }
  const deleted = await deleteOverride(id);
  return NextResponse.json({ deleted });
}
