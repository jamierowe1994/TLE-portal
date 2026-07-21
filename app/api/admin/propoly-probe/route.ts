import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import {
  propolyConfigured,
  propolyClientName,
  getPropolyAgents,
  getPropolyBranches,
  getPropolyDeals,
  getPropolyProperties,
  type PropolyResult,
} from "@/lib/propoly";

// Admin-only diagnostic for wiring Propoly up. Their Swagger doesn't publish
// response schemas, so this reports the connection plus a real sample from
// each read endpoint we care about — the KEYS of the first row and how many
// rows came back, never tenant personal data. Once we've seen the shapes we
// wire deals → Applications/Pipeline mappings from evidence, not guesswork.
//
// GET /api/admin/propoly-probe → { configured, clientName, endpoints: {...} }

/** Shrink a raw endpoint result to structure only (status, count, row keys). */
function summarise(res: PropolyResult) {
  const body = res.body;
  let rows: unknown[] | null = null;
  if (Array.isArray(body)) {
    rows = body;
  } else if (body && typeof body === "object") {
    // Common wrappers: { data: [...] } / { items: [...] } / { deals: [...] }
    const obj = body as Record<string, unknown>;
    const arrayProp = Object.entries(obj).find(([, v]) => Array.isArray(v));
    if (arrayProp) rows = arrayProp[1] as unknown[];
  }
  const first = rows?.[0];
  return {
    status: res.status,
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
  if (!propolyConfigured()) {
    return NextResponse.json({
      configured: false,
      hint: "Add PROPOLY_API_KEY (the long key) and PROPOLY_AGENT_NAME (the username) in Railway or .env.local, then redeploy/restart.",
    });
  }

  try {
    const [agents, branches, deals, properties] = await Promise.all([
      getPropolyAgents(),
      getPropolyBranches(),
      getPropolyDeals(),
      getPropolyProperties(),
    ]);

    return NextResponse.json({
      configured: true,
      clientName: propolyClientName(),
      endpoints: {
        agents: summarise(agents),
        branches: summarise(branches),
        deals: summarise(deals),
        properties: summarise(properties),
      },
    });
  } catch (e) {
    // Most likely the token call itself failed — bad key or agent name.
    return NextResponse.json({
      configured: true,
      ok: false,
      error: e instanceof Error ? e.message : "Propoly probe failed",
      hint: "A 401/403 on the token call means the key or agent name doesn't match what Propoly issued.",
    });
  }
}
