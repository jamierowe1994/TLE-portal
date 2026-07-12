// Core data model — CONTRACT (all build lanes import from here).
// Do not change shapes without updating the build spec.

export type StatSource = "live-rex" | "live-meta" | "manual" | "snapshot" | "derived";

export interface StatValue {
  value: number | null;            // null = genuinely unknown → render "—"
  display?: string;                // preformatted ("£12,000", "90%") — use when set
  source: StatSource;
  note?: string;                   // e.g. "Couldn't match a live REX stat yet — figure from TLE Business Dashboard snapshot, 11 Jul 2026"
  asOf?: string;                   // ISO date of the figure
}

export interface FunnelStats {     // one agent OR whole business, one period
  marketAppraisals: StatValue;
  listings: StatValue;
  viewings: StatValue;
  applications: StatValue;
  moveIns: StatValue;
  pipeline: StatValue;             // forward pipeline count
  liveListings?: StatValue;
  gci?: StatValue;                 // £ exc VAT
}

export interface ConversionStats {
  leadToMa: StatValue;             // % — from Meta/paid leads vs MAs booked
  maToListing: StatValue;          // %
  listingToMoveIn: StatValue;      // %
  gciPerMoveIn?: StatValue;        // £
}

export interface AgentForecast {
  userId: string;
  month: string;                   // "2026-07"
  gciTarget: number | null;        // £ exc VAT
  moveInsTarget: number | null;
  maTarget: number | null;
  notes?: string;
  updatedAt: string;               // ISO
}

export interface UserProfile {     // port of TEG shape, trimmed to TLE needs
  id: string;
  name: string;
  email: string;
  mobile: string;
  photo: string | null;
  agentKey: string | null;         // slug linking user → roster/seed data, e.g. "rhiannon-dodge" (admin-set)
  rexUserId: string | null;        // admin-set — REX AccountUsers id
  metaCampaignId: string | null;   // admin-set — Meta campaign id for their ads
  location: string | null;
  adsConnected?: boolean;          // agent linked their ads to the Ads app (My Ads)
  isAdmin?: boolean;               // derived server-side from ADMIN_EMAILS; never stored
  createdAt: string;
}

export interface AdminNote {
  at: string;                      // ISO
  text: string;
}

// Admin manual override of an actual figure (lib/actuals-store.ts).
// Metrics use dot keys like "funnel.moveIns", "income.combinedGci".
export interface ActualOverride {
  id: string;
  scope: "business" | "agent";
  agentKey?: string;
  month: string;                   // "2026-07"
  metric: string;
  value: number;
  note?: string;
  updatedAt: string;               // ISO
}
