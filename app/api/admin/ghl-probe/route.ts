import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import {
  ghlConfigured,
  getGhlContacts,
  getGhlLocation,
  getGhlOpportunities,
  getGhlPipelines,
  type GhlResult,
} from "@/lib/ghl";

// Admin-only diagnostic for wiring Go High Level up — same pattern as the
// Propoly probe: reports the connection plus the STRUCTURE of a real sample
// from each read endpoint (row counts + first-row keys, never lead personal
// data), so the Paid Leads funnel gets mapped from evidence, not guesswork.
//
// GET /api/admin/ghl-probe → { configured, endpoints: {...} }

function summarise(res: GhlResult) {
  const body = res.body;
  let rows: unknown[] | null = null;
  if (Array.isArray(body)) {
    rows = body;
  } else if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const arrayProp = Object.entries(obj).find(([, v]) => Array.isArray(v));
    if (arrayProp) rows = arrayProp[1] as unknown[];
  }
  const first = rows?.[0];
  let errorMessage: string | null = null;
  if (res.status >= 400 && body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const msg = obj.message ?? obj.error ?? obj.errors;
    if (msg != null) errorMessage = JSON.stringify(msg);
  }
  return {
    status: res.status,
    errorMessage,
    envelopeKeys:
      body && typeof body === "object" && !Array.isArray(body)
        ? Object.keys(body as Record<string, unknown>)
        : Array.isArray(body)
          ? ["<top-level array>"]
          : [],
    rowCount: rows ? rows.length : null,
    firstRowKeys:
      first && typeof first === "object"
        ? Object.keys(first as Record<string, unknown>)
        : [],
  };
}

export async function GET(req: NextRequest) {
  const adminId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = adminId ? await findById(adminId) : null;
  if (!admin) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  if (!isAdminEmail(admin.email)) {
    return NextResponse.json(
      { error: "This area is locked to the business owner." },
      { status: 403 }
    );
  }
  if (!ghlConfigured()) {
    return NextResponse.json({
      configured: false,
      hint:
        "Add GHL_API_TOKEN (Private Integration token: sub-account Settings → " +
        "Private Integrations → create with read scopes for contacts, " +
        "opportunities and locations) and GHL_LOCATION_ID (the sub-account id) " +
        "in Railway or .env.local, then redeploy/restart.",
    });
  }

  try {
    const [location, pipelines, opportunities, contacts] = await Promise.all([
      getGhlLocation(),
      getGhlPipelines(),
      getGhlOpportunities(),
      getGhlContacts(),
    ]);

    return NextResponse.json({
      configured: true,
      endpoints: {
        location: summarise(location),
        pipelines: summarise(pipelines),
        opportunities: summarise(opportunities),
        contacts: summarise(contacts),
      },
    });
  } catch (e) {
    return NextResponse.json({
      configured: true,
      ok: false,
      error: e instanceof Error ? e.message : "GHL probe failed",
      hint:
        "A 401 usually means the Private Integration token is wrong or missing " +
        "a scope; a 403 means the token doesn't cover this location.",
    });
  }
}
