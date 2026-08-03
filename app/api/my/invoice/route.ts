import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import {
  EMPTY_PROFILE,
  getInvoiceProfile,
  saveInvoiceProfile,
  type InvoiceProfile,
} from "@/lib/invoice-store";
import { getAgentFeeLines } from "@/lib/payprop-income";

// The invoicing tool's data: the agent's own business details, and the fee
// lines behind their earnings for a month so they can be invoiced per
// property.
//
// The fee lines come from the SAME engine as the earnings card — same fee
// categories, same transfer-date month, same VAT basis. An invoice that
// disagreed with the figure on their dashboard would be the worst bug this
// tool could have.
//
// GET  /api/my/invoice?month=2026-07 → { profile, lines, month }
// POST /api/my/invoice  { profile }  → { profile }

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const month =
    req.nextUrl.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "Need ?month=YYYY-MM" }, { status: 400 });
  }

  const [profile, lines] = await Promise.all([
    getInvoiceProfile(user.id),
    getAgentFeeLines(user.email, user.name ?? "", month).catch(() => null),
  ]);

  return NextResponse.json({
    profile,
    month,
    // null means we could not ask PayProp — distinct from [] meaning "no fees
    // settled that month". The page says which.
    lines,
  });
}

export async function POST(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: { profile?: Partial<InvoiceProfile> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const p = body.profile ?? {};
  const str = (v: unknown, fallback = "") =>
    typeof v === "string" ? v.trim().slice(0, 400) : fallback;

  const saved = await saveInvoiceProfile(user.id, {
    businessName: str(p.businessName),
    address: str(p.address),
    email: str(p.email),
    phone: str(p.phone),
    vatNumber: str(p.vatNumber),
    bankDetails: str(p.bankDetails),
    feePercent: Number(p.feePercent ?? EMPTY_PROFILE.feePercent),
    nextNumber: Number(p.nextNumber ?? 1),
  });
  return NextResponse.json({ profile: saved });
}
