import "server-only";

// Go High Level (LeadConnector) client — feeds Paid Leads and the lead→MA
// funnel once connected. API v2, authenticated with a PRIVATE INTEGRATION
// token (GHL → sub-account Settings → Private Integrations → create with
// read scopes for contacts + opportunities), scoped to one location.
//
//   GHL_API_TOKEN    — the private integration token ("pit-…")
//   GHL_LOCATION_ID  — the sub-account/location id the token belongs to
//
// Same defensive posture as lib/propoly.ts: never throw into a page, return
// { status, body } so the admin probe can show exactly what the API said.

const BASE = (process.env.GHL_API_BASE ?? "https://services.leadconnectorhq.com").replace(/\/$/, "");
const TOKEN = process.env.GHL_API_TOKEN ?? "";
const LOCATION_ID = process.env.GHL_LOCATION_ID ?? "";
// GHL versions every request with a fixed date header.
const API_VERSION = "2021-07-28";

export function ghlConfigured(): boolean {
  return Boolean(TOKEN && LOCATION_ID);
}

export interface GhlResult {
  status: number;
  body: unknown;
}

export async function ghlGet(path: string): Promise<GhlResult> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Version: API_VERSION,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/* ------------------------------------------------------------------------ */
/* Read endpoints the portal cares about                                     */
/* ------------------------------------------------------------------------ */

/** The location's pipelines + stages — the shape of the lead→MA funnel. */
export const getGhlPipelines = () =>
  ghlGet(`/opportunities/pipelines?locationId=${encodeURIComponent(LOCATION_ID)}`);

/** A page of opportunities (leads moving through the funnel). */
export const getGhlOpportunities = (limit = 20) =>
  ghlGet(
    `/opportunities/search?location_id=${encodeURIComponent(LOCATION_ID)}&limit=${limit}`
  );

/** A page of contacts (raw leads). */
export const getGhlContacts = (limit = 20) =>
  ghlGet(`/contacts/?locationId=${encodeURIComponent(LOCATION_ID)}&limit=${limit}`);

/** The location record itself — cheapest "is the token valid" check. */
export const getGhlLocation = () =>
  ghlGet(`/locations/${encodeURIComponent(LOCATION_ID)}`);

/* ------------------------------------------------------------------------ */
/* Paid-leads funnel (admin Paid Leads tab)                                  */
/* ------------------------------------------------------------------------ */

// Mapping validated against Susan's 11 Jul 2026 dashboard snapshot and the
// live pipeline on 23 Jul 2026:
//   • pipelines named "… Paid Leads" hold the paid funnel (they seem to make
//     a fresh one per campaign period — "May 26 Paid Leads" — so we match on
//     NAME, not a hard-coded id, and sum across matches);
//   • "Initial Call Booked" stage = the lead was referred to an agent;
//   • "MA Booked" stage or status "won" = MA booked (the pipeline's 2 all-
//     time wins matched her "MAs booked: 2" exactly).

export interface GhlPaidLeadsMtd {
  leads: number; // opportunities created in the month
  referred: number; // reached Initial Call Booked / MA Booked / won
  masBooked: number; // reached MA Booked / won
  pipelines: string[]; // which pipelines were counted (shown in the note)
  generatedAt: string;
}

const FUNNEL_TTL_MS = 5 * 60_000;
const MAX_PAGES = 20;
let funnelCache: { at: number; month: string; data: GhlPaidLeadsMtd } | null = null;

/** Last day of "YYYY-MM" as MM-DD-YYYY (GHL's search date format). */
function monthEndUs(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${String(m).padStart(2, "0")}-${lastDay}-${y}`;
}

export async function getGhlPaidLeadsMtd(month: string): Promise<GhlPaidLeadsMtd | null> {
  if (!ghlConfigured()) return null;
  if (
    funnelCache &&
    funnelCache.month === month &&
    Date.now() - funnelCache.at < FUNNEL_TTL_MS
  ) {
    return funnelCache.data;
  }

  const pipesRes = await getGhlPipelines();
  if (pipesRes.status !== 200) return null;
  const allPipes = ((pipesRes.body as Record<string, unknown>)?.pipelines ??
    []) as Array<Record<string, unknown>>;
  const paidPipes = allPipes.filter(
    (p) => typeof p.name === "string" && /paid\s*leads/i.test(p.name)
  );
  if (paidPipes.length === 0) return null;

  // stageId → is-referred / is-ma, matched by stage NAME per pipeline.
  const referredStageIds = new Set<string>();
  const maStageIds = new Set<string>();
  for (const p of paidPipes) {
    for (const s of (p.stages ?? []) as Array<Record<string, unknown>>) {
      const name = String(s.name ?? "");
      const id = String(s.id ?? "");
      if (/ma\s*(appointment\s*)?booked/i.test(name)) {
        maStageIds.add(id);
        referredStageIds.add(id);
      } else if (/initial\s*call\s*booked/i.test(name)) {
        referredStageIds.add(id);
      }
    }
  }

  const startUs = `${month.slice(5, 7)}-01-${month.slice(0, 4)}`;
  let leads = 0;
  let referred = 0;
  let masBooked = 0;
  for (const p of paidPipes) {
    let path: string | null =
      `/opportunities/search?location_id=${encodeURIComponent(LOCATION_ID)}` +
      `&pipeline_id=${encodeURIComponent(String(p.id))}` +
      `&limit=100&date=${startUs}&endDate=${monthEndUs(month)}`;
    for (let page = 0; page < MAX_PAGES && path; page++) {
      const res: GhlResult = await ghlGet(path);
      if (res.status !== 200) return null; // partial counts read as truth — bail
      const body = res.body as Record<string, unknown>;
      const rows = (body.opportunities ?? []) as Array<Record<string, unknown>>;
      for (const o of rows) {
        leads += 1;
        const stageId = String(o.pipelineStageId ?? "");
        const won = o.status === "won";
        if (won || referredStageIds.has(stageId)) referred += 1;
        if (won || maStageIds.has(stageId)) masBooked += 1;
      }
      const next = (body.meta as Record<string, unknown> | undefined)?.nextPageUrl;
      path =
        typeof next === "string" && next.startsWith(BASE)
          ? next.slice(BASE.length)
          : null;
    }
  }

  const data: GhlPaidLeadsMtd = {
    leads,
    referred,
    masBooked,
    pipelines: paidPipes.map((p) => String(p.name)),
    generatedAt: new Date().toISOString(),
  };
  funnelCache = { at: Date.now(), month, data };
  return data;
}
