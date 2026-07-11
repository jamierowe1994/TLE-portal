// SEED lane — internal types for lib/seed-data.ts.
// Shared cross-lane types (StatValue, FunnelStats, …) live in lib/types.ts.

import type { StatValue } from "@/lib/types";

/* ---------------------------------- roster --------------------------------- */

export type Region = "E&W" | "Glasgow" | "Edinburgh";
export type PartnerType = "TLE" | "TLE Dual" | "Lettings Lite";

export interface RosterEntry {
  agentKey: string;          // slug, e.g. "rhiannon-dodge"
  displayName: string;       // verbatim as it appears on Susan's dashboard
  region: Region;
  partnerType: PartnerType;
  active: boolean;
}

/* ------------------------------- source status ----------------------------- */

export type SourceKey = "rex" | "payprop" | "ghl" | "meta";
export type SourceStatus = "live" | "attempting-live" | "no-access-yet";

export interface SourceInfo {
  status: SourceStatus;
  label: string;             // human name of the system
  note: string;              // what it feeds / access situation
}

/* --------------------------------- tables ---------------------------------- */

export interface MoveInRow {
  agent: string;                       // verbatim agent name
  property: string;
  applicationDate: string | null;      // "—" on dashboard → null
  moveInDate: string;                  // e.g. "01 Jul 2026"
  letType: "New Let" | "Relet";
  serviceLevel: string;                // "Tenant Find" | "EFM no RLP" | "EFM with RLP"
  rentPcm: number;
  setupFee: number;
  monthlyMgmtFee: number;
  twelveMonthValue: number;            // "12M Cost Value" column
}

export type PipelineStatus =
  | "PLC Sign Off"
  | "Tenancy Generation"
  | "Awaiting References"
  | "Signing and Move in Monies";

export interface PipelineRow {
  agent: string;                       // verbatim agent name
  property: string;
  expectedMoveIn: string;              // "12 Jul 2026" or "TBC" (verbatim)
  serviceLevel: string;
  status: PipelineStatus;
  rentPcm: number;
  period: "july" | "aug-sep";          // which pipeline table the row came from
}

export interface IncomeMonthlyRow {
  metric: string;
  jan: number | null;
  feb: number | null;
  mar: number | null;
  q1: number | null;
  apr: number | null;
  may: number | null;
  jun: number | null;
  q2: number | null;
  ytd: number | null;
}

export interface LicenceFeeRow {
  month: string;
  monthlyLicence: number | null;
  proLicence: number | null;
  joiningFees: number | null;
  total: number | null;
}

export interface H2ReforecastRow {
  key: string;
  label: string;
  kind: "count" | "currency" | "pct";
  values: number[];                    // Jul..Dec (6 values)
  h2Total: number;
}

export interface BaselineCostRow {
  label: string;
  value: number;
}

export interface AgentKpiRow {
  tier: string;                        // "DEV" etc.
  agent: string;                       // verbatim agent name
  gci: number | null;
  ma: number | null;
  li: number | null;
  vw: number | null;
  ap: number | null;
  mi: number | null;
  pn: number | null;
}

export interface PartnerNetIncomeRow {
  agent: string;                       // verbatim agent name
  tag?: "NEW" | "GLASGOW" | "TLE";     // row badge shown on the dashboard
  jan: number | null;
  feb: number | null;
  mar: number | null;
  apr: number | null;
  may: number | null;
  jun: number | null;
  ytdTotal: number;
}

export interface PortfolioRow {
  agent: string;                       // verbatim agent name
  managed: number;
  letOnly: number;
  total: number;
  rlpLec: number;                      // RLP/LEC column (RLP incl. LEC)
  rentRoll: number | null;
  avgRent: number | null;
}

export interface ArrearsAgingBucket {
  label: string;                       // "< 7 days" etc.
  count: number;
  value: number;
}

export interface ArrearsTenantRow {
  tenant: string;
  property: string;
  region: "E&W" | "Glasgow";
  balance: number;
  status: string;                      // "ACTIVE"
  protection: string;                  // "None"
  lastInvoice: string | null;          // ISO-ish "2026-06-26"
  lastPayment: string | null;
  lastReminder: string | null;
}

export interface ComplianceTypeRow {
  type: string;
  total: number;
  overdue: number;
  upcoming: number;
}

export interface ComplianceAgentRow {
  agent: string;                       // verbatim agent name
  total: number;
  overdue: number;
  upcoming: number;
  pctOverdue: number;                  // e.g. 48 for "48%"
}

export interface ComplianceItemRow {
  task: string;                        // "EPC 9 Plested Court" (property/task combined)
  type: string;
  manager: string;                     // verbatim agent name
  status: string;                      // "Not Started" | "In Progress" | "Completed"
  expires: string;                     // "2025-12-22"
  dueIn: string;                       // "OVERDUE" | "1d" | "23d" …
}

/* ------------------------------ compound stats ------------------------------ */

export interface YoYGrowthEntry {
  label: string;
  from: number;
  to: number;
  stat: StatValue;                     // value = "to", display = "from → to"
}
