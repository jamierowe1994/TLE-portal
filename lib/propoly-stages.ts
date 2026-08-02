// Client-safe stage + pre-tenancy checklist constants, shared by the agent
// Applications page, Kirstie's /pretenancy board and the server-side deal
// mappers. No server-only imports — this ships in the client bundle.
//
// The PORTAL pipeline is 8 stages (Kirstie's process). Propoly only tracks 5
// statuses, so each raw Propoly status maps to a default portal stage, and
// the portal-only stages (PLC, Deposit, Rent payment, Move day) are reached
// by Kirstie moving the deal herself (stage overrides in lib/deal-store.ts).

import type { ApplicationStage } from "@/lib/rex-stats"; // type-only — erased

export interface PortalStageInfo {
  key: string;
  label: string;
  stage: ApplicationStage; // coarse bucket the agent tiles group by
  order: number; // progression order, asc = earliest
  blurb: string; // what's actually happening at this stage
}

export const PORTAL_STAGES: PortalStageInfo[] = [
  {
    key: "deal_started",
    label: "Deal started",
    stage: "received",
    order: 0,
    blurb: "Terms agreed — the deal is being set up with rent, dates and tenant details.",
  },
  {
    key: "holding_fee",
    label: "Holding fee",
    stage: "received",
    order: 1,
    blurb: "Collecting the holding fee that takes the property off the market.",
  },
  {
    key: "referencing",
    label: "Referencing",
    stage: "communicated",
    order: 2,
    blurb: "Credit, employer and previous-landlord checks.",
  },
  {
    key: "plc",
    label: "PLC",
    stage: "communicated",
    order: 3,
    blurb: "Pre-let compliance — Right to Rent, gas/EICR/EPC certificates and licensing.",
  },
  {
    key: "deposit",
    label: "Deposit",
    stage: "accepted",
    order: 4,
    blurb: "Collecting the tenancy deposit and registering it with the scheme.",
  },
  {
    key: "tenancy_agreement",
    label: "Tenancy agreement",
    stage: "accepted",
    order: 5,
    blurb: "The agreement is drawn up with the agreed clauses and signed by all parties.",
  },
  {
    key: "rent_payment",
    label: "Rent payment",
    stage: "accepted",
    order: 6,
    blurb: "First month's rent collected and the standing order set up.",
  },
  {
    key: "move_day",
    label: "Move day",
    stage: "accepted",
    order: 7,
    blurb: "Keys, inventory and check-in — moving day.",
  },
];

export const PORTAL_STAGE_BY_KEY: Record<string, PortalStageInfo> =
  Object.fromEntries(PORTAL_STAGES.map((s) => [s.key, s]));

/** Where each raw Propoly status lands on the portal pipeline by default. */
export const PROPOLY_TO_PORTAL: Record<string, string> = {
  start_deal: "deal_started",
  holding_fee: "holding_fee",
  references: "referencing",
  tenancy_generation: "tenancy_agreement",
  signing_and_move_in_monies: "rent_payment",
  complete: "move_day",
};

/** Raw Propoly status → default portal stage key ("cancelled" passes through). */
export function portalStageOf(rawStatusKey: string): string {
  return PROPOLY_TO_PORTAL[rawStatusKey] ?? rawStatusKey;
}

export const PROPOLY_APP_URL = "https://prod.propoly.com";

/* --------------------------- pre-tenancy checklist --------------------------- */

// The admin steps Kirstie tracked on her spreadsheet, one tick each per deal.
export const CHECKLIST_ITEMS: { key: string; label: string }[] = [
  { key: "holding_fee", label: "Holding fee received" },
  { key: "references", label: "References passed" },
  { key: "right_to_rent", label: "Right to Rent verified" },
  { key: "agreement_sent", label: "Tenancy agreement sent" },
  { key: "agreement_signed", label: "Agreement signed by all parties" },
  { key: "deposit_registered", label: "Deposit registered" },
  { key: "monies_received", label: "Move-in monies received" },
  { key: "standing_order", label: "Standing order set up" },
  { key: "keys_inventory", label: "Keys & inventory arranged" },
];

/* --------------------------- service level vocabulary --------------------------- */

/**
 * Propoly and PayProp name the same three products differently:
 *
 *   Propoly (tenancy_service_level)   PayProp (service_level)
 *   full_managed  -> "Fully managed"  "Fully managed"
 *   tenant_find   -> "Tenant find"    "Let only"
 *   rent_collect  -> "Rent collect"   "Rent collect"
 *
 * "Tenant find" and "Let only" are the same thing under two names. Anything
 * that compares the two sources, or branches on the level, has to normalise
 * first — otherwise a Let Only property read from PayProp and a Tenant Find
 * one read from Propoly look like different products and get different
 * treatment for no reason.
 */
export function normaliseServiceLevel(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("manage")) return "Fully managed";
  if (s.includes("rent collect")) return "Rent collect";
  if (s.includes("tenant find") || s.includes("let only")) return "Let only";
  return null; // an unrecognised label is not guessed at
}

/**
 * Where a cash deposit can be held. Propoly's own vocabulary (its
 * configuration endpoint lists exactly the six scheme variants) plus the two
 * real-world states the probe found: deposits held by the landlord (a REX
 * bond_deposit_type value staff have used) and Flatfair, where there is no
 * cash deposit at all. The PORTAL is the register for this — no upstream
 * system records which scheme holds a given deposit (probed 2 Aug 2026).
 */
export const DEPOSIT_SCHEMES: string[] = [
  "TDS Custodial",
  "TDS Insured",
  "DPS Custodial",
  "DPS Insured",
  "My Deposits Custodial",
  "My Deposits Insured",
  // Scotland's scheme — it appears as an actual PayProp beneficiary
  // ("Safe Deposits Scotland"), which is how auto-detection finds it.
  "SafeDeposits Scotland",
  "Held by landlord",
  "Flatfair (no cash deposit)",
];
