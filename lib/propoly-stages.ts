// Client-safe Propoly stage + pre-tenancy checklist constants, shared by the
// agent Applications page, Kirstie's /pretenancy dashboard and the server-side
// deal mappers. No server-only imports — this ships in the client bundle.

import type { ApplicationStage } from "@/lib/rex-stats"; // type-only — erased

export interface PropolyStageInfo {
  key: string;
  label: string;
  stage: ApplicationStage; // portal pipeline bucket the status maps to
  order: number; // progression order, asc = earliest
  blurb: string; // what's actually happening at this stage
}

// The five stages a deal walks through on its way to keys-in-hand.
export const PROPOLY_STAGES: PropolyStageInfo[] = [
  {
    key: "start_deal",
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
    key: "references",
    label: "Referencing",
    stage: "communicated",
    order: 2,
    blurb: "Credit, employer and previous-landlord checks, plus Right to Rent.",
  },
  {
    key: "tenancy_generation",
    label: "Tenancy agreement",
    stage: "communicated",
    order: 3,
    blurb: "The agreement is being drawn up with all the agreed clauses.",
  },
  {
    key: "signing_and_move_in_monies",
    label: "Signing & move-in monies",
    stage: "accepted",
    order: 4,
    blurb: "Signatures, plus the first month's rent and deposit being collected.",
  },
];

export const PROPOLY_STAGE_BY_KEY: Record<string, PropolyStageInfo> =
  Object.fromEntries(PROPOLY_STAGES.map((s) => [s.key, s]));

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
