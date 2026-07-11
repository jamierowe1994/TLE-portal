import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import {
  getForecast,
  setForecast,
  listUserForecasts,
} from "@/lib/forecast-store";
import { currentMonth } from "@/lib/format";
import { agentNetIncomeYtd } from "@/lib/seed-data";
import type { AgentForecast } from "@/lib/types";

// The signed-in agent's OWN monthly forecast (targets).
// GET  ?month=2026-07  → { month, forecast, history, actuals }
//   history = all their months; actuals = { "2026-01": net£ | null, … } from
//   the partner net income seed for their linked agentKey (server-side —
//   lib/seed-data.ts is server-only and must not ship in the client bundle).
// PUT  { month, gciTarget, moveInsTarget, maTarget, notes } → { forecast }

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

async function requireUserId(req: NextRequest): Promise<string | null> {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  const user = await findById(userId);
  return user ? userId : null;
}

export async function GET(req: NextRequest) {
  const userId = await requireUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const monthParam = req.nextUrl.searchParams.get("month");
  const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : currentMonth();

  const [user, forecast, history] = await Promise.all([
    findById(userId),
    getForecast(userId, month),
    listUserForecasts(userId),
  ]);

  // Seed actuals (partner net income, Jan–Jun 2026) for the history table.
  const row = user?.agentKey ? agentNetIncomeYtd(user.agentKey) : null;
  const actuals: Record<string, number | null> = row
    ? {
        "2026-01": row.jan,
        "2026-02": row.feb,
        "2026-03": row.mar,
        "2026-04": row.apr,
        "2026-05": row.may,
        "2026-06": row.jun,
      }
    : {};

  return NextResponse.json({ month, forecast, history, actuals });
}

/** null/undefined/"" → null; otherwise must parse to a finite number ≥ 0. */
function targetOrNull(raw: unknown, field: string): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${field} must be a number of 0 or more (or empty).`);
  }
  return n;
}

export async function PUT(req: NextRequest) {
  const userId = await requireUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const month = typeof body.month === "string" ? body.month : "";
  if (!MONTH_RE.test(month)) {
    return NextResponse.json(
      { error: 'month must look like "2026-07".' },
      { status: 400 }
    );
  }

  let gciTarget: number | null;
  let moveInsTarget: number | null;
  let maTarget: number | null;
  try {
    gciTarget = targetOrNull(body.gciTarget, "GCI target");
    moveInsTarget = targetOrNull(body.moveInsTarget, "Move-ins target");
    maTarget = targetOrNull(body.maTarget, "MA target");
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid target value." },
      { status: 400 }
    );
  }

  const notes =
    typeof body.notes === "string" && body.notes.trim()
      ? body.notes.trim().slice(0, 2000)
      : undefined;

  const forecast: AgentForecast = {
    userId,
    month,
    gciTarget,
    moveInsTarget,
    maTarget,
    notes,
    updatedAt: new Date().toISOString(),
  };
  await setForecast(forecast);
  return NextResponse.json({ forecast });
}
