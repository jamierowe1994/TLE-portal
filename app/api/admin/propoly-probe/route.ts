import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import {
  propolyConfigured,
  propolyClientName,
  getPropolyAgents,
  getPropolyBranches,
  getPropolyDeals,
  getPropolyDeal,
  getPropolyProperties,
  propolyGet,
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
  // On errors, the message VALUE is the diagnosis (e.g. "Token expired",
  // "Insufficient permissions") — safe to expose, no tenant data in it.
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

    // ---- how does a tenancy agreement actually get issued? -----------------
    //
    // The deals LIST is all the portal has ever read, and it carries no
    // document fields at all. Two things could be true: Propoly holds the
    // agreement and the list simply omits it, or the agreement lives in a
    // separate system entirely. The list alone cannot tell them apart.
    //
    // So: pull ONE full deal and diff its keys against the list row, then ask
    // for the document-shaped endpoints and report what comes back. A 404 is
    // as much of an answer as a 200 — it rules a route out instead of leaving
    // it a guess.
    const dealRows = (() => {
      const b = deals.body;
      if (Array.isArray(b)) return b as Array<Record<string, unknown>>;
      if (b && typeof b === "object") {
        const found = Object.values(b as Record<string, unknown>).find((v) =>
          Array.isArray(v)
        );
        if (Array.isArray(found)) return found as Array<Record<string, unknown>>;
      }
      return [];
    })();
    const listKeys = dealRows[0] ? Object.keys(dealRows[0]) : [];
    const sampleId = String(dealRows[0]?.uuid ?? dealRows[0]?.id ?? "");

    let fullDeal: Record<string, unknown> | null = null;
    if (sampleId) {
      const one = await getPropolyDeal(sampleId).catch(() => null);
      const b = one?.body;
      if (b && typeof b === "object" && !Array.isArray(b)) {
        const inner = (b as Record<string, unknown>).data;
        fullDeal =
          inner && typeof inner === "object"
            ? (inner as Record<string, unknown>)
            : (b as Record<string, unknown>);
      }
    }

    const DOC_WORDS = /doc|agree|contract|sign|template|tenancy|file|attach/i;
    const paths = sampleId
      ? [
          `/api/v1/deals/${sampleId}/documents`,
          `/api/v1/deals/${sampleId}/files`,
          `/api/v1/deals/${sampleId}/agreements`,
          "/api/v1/documents",
          "/api/v1/agreements",
          "/api/v1/templates",
        ]
      : [];
    const documentRoutes: Record<string, unknown> = {};
    for (const path of paths) {
      const r = await propolyGet(path).catch(() => null);
      documentRoutes[path] = r
        ? { status: r.status, ...(r.status < 400 ? summarise(r) : {}) }
        : { status: "call threw" };
    }

    return NextResponse.json({
      configured: true,
      clientName: propolyClientName(),
      endpoints: {
        agents: summarise(agents),
        branches: summarise(branches),
        deals: summarise(deals),
        properties: summarise(properties),
      },
      contracts: {
        sampleDealFound: Boolean(sampleId),
        listRowKeys: listKeys,
        fullDealKeys: fullDeal ? Object.keys(fullDeal) : [],
        // What the single-deal call gives us that the list does not — this is
        // where an agreement field would show up if Propoly holds one.
        extraOnFullDeal: fullDeal
          ? Object.keys(fullDeal).filter((k) => !listKeys.includes(k))
          : [],
        documentShapedKeys: fullDeal
          ? Object.keys(fullDeal).filter((k) => DOC_WORDS.test(k))
          : [],
        documentRoutes,
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
