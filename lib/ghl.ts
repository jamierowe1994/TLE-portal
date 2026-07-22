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
