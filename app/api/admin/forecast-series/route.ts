import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { listForecasts } from "@/lib/forecast-store";
import { getOverrides } from "@/lib/actuals-store";
import { getGciSeries } from "@/lib/gci-history";
import { recentMonths } from "@/lib/format";

/**
 * The three forecasts, month by month, so they can be looked at together.
 *
 * Susan sets a number for the business. The partners each set their own, which
 * roll up to a second number. Then the month happens and produces a third.
 * Until now those lived in three different places and nobody could say whether
 * the first two were anywhere near each other, which was the whole question.
 *
 * Susan's is stored as a manual override under `forecast.susan.<month>` — the
 * same store the P&L uses. One store for "a person typed this", rather than a
 * new table per figure.
 *
 * GET /api/admin/forecast-series?months=12
 *   → { months, susan[], partners[], actual[] }  (nulls where nothing is set)
 */
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const n = Math.min(Math.max(Number(req.nextUrl.searchParams.get("months") ?? 12), 3), 24);
  const months = recentMonths(n);

  const [perMonth, gci] = await Promise.all([
    Promise.all(
      months.map(async (m) => {
        const [forecasts, overrides] = await Promise.all([
          listForecasts(m).catch(() => []),
          getOverrides(m).catch(() => []),
        ]);
        const partners = forecasts.reduce((t, f) => t + (f.gciTarget ?? 0), 0);
        const susanRow = overrides.find((o) => o.metric === `forecast.susan.${m}`);
        return {
          month: m,
          // A month nobody forecast is NULL, not zero. Zero draws a bar at the
          // floor and reads as "they forecast nothing", which is a different
          // and much worse claim than "nobody has said yet".
          partners: forecasts.length ? partners : null,
          susan: susanRow ? susanRow.value : null,
          agentsForecasted: forecasts.length,
        };
      })
    ),
    getGciSeries().catch(() => null),
  ]);

  const actualBy = new Map(
    (gci?.months ?? []).map((m) => [m.month, Math.round(m.combinedGciNet)])
  );

  return NextResponse.json({
    months,
    rows: perMonth.map((r) => ({ ...r, actual: actualBy.get(r.month) ?? null })),
  });
}
