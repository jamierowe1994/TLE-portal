import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { getAllPropolyDeals, getPropolyMoveInRows } from "@/lib/propoly-deals";
import { propolyConfigured } from "@/lib/propoly";

// The two Move-ins tables, live from Propoly.
//
// Both were a hand-made capture taken on 11 Jul 2026, which is why they sat on
// July whatever month was picked — and why they disagreed with the tracker
// beside them. The capture holds ten rows; Propoly's own answer for July is
// thirty-five, because the capture was taken on the 11th and the month kept
// going.
//
// GET /api/admin/move-in-rows?month=YYYY-MM → { moveIns, pipeline }
//   moveIns   completed deals with a move-in date IN that month
//   pipeline  deals still in progression, expected in that month or undated
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!propolyConfigured()) {
    return NextResponse.json({ configured: false, moveIns: null, pipeline: null });
  }

  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  const [moveIns, deals] = await Promise.all([
    getPropolyMoveInRows(month).catch(() => null),
    getAllPropolyDeals().catch(() => null),
  ]);

  // A deal with no expected date is still real work — it belongs to the month
  // being looked at rather than disappearing because nobody has typed a date.
  const pipeline =
    deals == null
      ? null
      : deals
          .filter((d) => {
            const start = d.app.startDate ?? "";
            return start ? start.slice(0, 7) === month : true;
          })
          .map((d) => ({
            id: d.app.id,
            agent: d.managerName,
            property: d.app.propertyName,
            locality: d.app.locality,
            expected: d.app.startDate,
            service: d.app.propoly?.service ?? null,
            status: d.app.status,
            rentPcm: d.app.offer,
          }))
          .sort((a, b) => (a.expected ?? "9999").localeCompare(b.expected ?? "9999"));

  return NextResponse.json({
    configured: true,
    month,
    moveIns,
    pipeline,
    generatedAt: new Date().toISOString(),
  });
}
