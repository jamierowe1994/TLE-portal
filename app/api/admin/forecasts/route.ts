import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, isAdminEmail, SESSION_COOKIE } from "@/lib/auth";
import { findById, listUsers } from "@/lib/users-store";
import { listForecasts } from "@/lib/forecast-store";
import { getOverrides } from "@/lib/actuals-store";
import { resolveStat } from "@/lib/stats";
import { currentMonth, daysElapsedFraction, formatGBP } from "@/lib/format";
import { ROSTER, SEED } from "@/lib/seed-data";
import type { AgentForecast, StatValue, UserProfile } from "@/lib/types";

// Admin roll-up: every ACTIVE roster agent joined with their linked portal
// user's self-set forecast for the month, summed into the business forecast
// ("10 agents × £10k ⇒ £100k expected"), plus actual MTD (combined GCI via
// resolveStat: manual override → snapshot), predicted month-end at the current
// run rate, and variance vs the partners' forecast.
// GET ?month=2026-07 → { month, rows, rollup, actualMtd, predictedMonthEnd,
//                        varianceVsForecast }

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface AdminForecastRow {
  agentKey: string;
  displayName: string;
  userLinked: boolean;
  forecast: AgentForecast | null;
}

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const sessionUser = await findById(userId);
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!isAdminEmail(sessionUser.email)) {
    return NextResponse.json(
      { error: "This area is locked to the business owner." },
      { status: 403 }
    );
  }

  const monthParam = req.nextUrl.searchParams.get("month");
  const month = monthParam && MONTH_RE.test(monthParam) ? monthParam : currentMonth();

  const [users, forecasts, overrides] = await Promise.all([
    listUsers(),
    listForecasts(month),
    getOverrides(month),
  ]);

  // Roster agent → linked user → that user's forecast for the month.
  const forecastByUserId = new Map<string, AgentForecast>();
  for (const f of forecasts) forecastByUserId.set(f.userId, f);
  const userByAgentKey = new Map<string, UserProfile>();
  for (const u of users) {
    if (u.agentKey) userByAgentKey.set(u.agentKey, u);
  }

  const rows: AdminForecastRow[] = ROSTER.filter((r) => r.active).map((r) => {
    const linked = userByAgentKey.get(r.agentKey) ?? null;
    return {
      agentKey: r.agentKey,
      displayName: r.displayName,
      userLinked: !!linked,
      forecast: linked ? forecastByUserId.get(linked.id) ?? null : null,
    };
  });

  const withForecast = rows.filter(
    (r) =>
      r.forecast &&
      (r.forecast.gciTarget != null ||
        r.forecast.moveInsTarget != null ||
        r.forecast.maTarget != null)
  );
  const sum = (pick: (f: AgentForecast) => number | null) =>
    withForecast.reduce((acc, r) => acc + (pick(r.forecast!) ?? 0), 0);

  const rollup = {
    totalGciTarget: sum((f) => f.gciTarget),
    totalMoveInsTarget: sum((f) => f.moveInsTarget),
    totalMaTarget: sum((f) => f.maTarget),
    agentsForecasted: withForecast.length,
    agentsTotal: rows.length,
  };

  // Actual MTD — business combined GCI. No live feed (PayProp pending), so:
  // manual override "income.combinedGci" → July snapshot estimate → unknown.
  const gciOverride = overrides.find(
    (o) => o.scope === "business" && o.metric === "income.combinedGci"
  );
  const snapshotGci = month === "2026-07" ? SEED.income.julyMtd.combinedGci : null;
  const actualMtd = resolveStat(
    null,
    gciOverride ? { value: gciOverride.value, note: gciOverride.note } : null,
    snapshotGci
  );

  // Predicted month-end = actual MTD ÷ fraction of the month elapsed.
  const fraction = daysElapsedFraction(month);
  const predictedValue =
    actualMtd.value != null && fraction > 0
      ? Math.round(actualMtd.value / fraction)
      : null;
  const predictedMonthEnd: StatValue = {
    value: predictedValue,
    display: predictedValue != null ? formatGBP(predictedValue) : undefined,
    source: "derived",
    note:
      predictedValue != null
        ? `Run rate: ${formatGBP(actualMtd.value)} MTD ÷ ${Math.round(
            fraction * 100
          )}% of month elapsed. Based on a ${actualMtd.source} figure.`
        : "Cannot predict — no actual MTD figure for this month yet.",
    asOf: actualMtd.asOf,
  };

  // Variance = predicted month-end vs the partners' combined GCI forecast.
  const varianceValue =
    predictedValue != null && rollup.agentsForecasted > 0
      ? predictedValue - rollup.totalGciTarget
      : null;
  const varianceVsForecast: StatValue = {
    value: varianceValue,
    display:
      varianceValue != null
        ? `${varianceValue >= 0 ? "+" : "−"}${formatGBP(Math.abs(varianceValue))}`
        : undefined,
    source: "derived",
    note:
      varianceValue != null
        ? `Predicted month-end ${formatGBP(predictedValue)} vs partners' forecast ${formatGBP(
            rollup.totalGciTarget
          )}. Inherits the ${actualMtd.source} actual.`
        : "Needs both an actual MTD figure and at least one partner forecast.",
    asOf: actualMtd.asOf,
  };

  return NextResponse.json({
    month,
    rows,
    rollup,
    actualMtd,
    predictedMonthEnd,
    varianceVsForecast,
  });
}
