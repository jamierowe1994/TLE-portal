// Core data model — CONTRACT (all build lanes import from here).
// Do not change shapes without updating the build spec.

export type StatSource = "live-rex" | "live-meta" | "live-propoly" | "live-teg" | "live-ghl" | "live-payprop" | "manual" | "snapshot" | "derived";

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

// The rows BEHIND the funnel counts — what opens up when an agent clicks a
// figure on their dashboard. A field is only present once that stage is wired
// to a real source; null means "we know the count but not (yet) the records",
// and the UI says exactly that rather than showing an empty list.
export interface MoveInsDrillRow {
  property: string;
  tenant: string;
  rent: number;                    // £ pcm
  from: string;                    // ISO date the tenancy starts
}

export interface ListingsDrillRow {
  address: string;
  rent: number | null;             // £ pcm
  letAgreed: boolean;
  status: string;                  // REX publication state, e.g. "Published"
  availableFrom: string | null;    // ISO date
}

export interface PipelineDrillRow {
  property: string;
  tenant: string;
  stage: string;                   // Propoly's own label, e.g. "Awaiting references"
  moveIn: string | null;           // ISO date the deal is expected to complete
  rent: number | null;             // £ pcm
}

export interface AppraisalsDrillRow {
  property: string;
  date: string | null;             // ISO — appraisal date, or the instruction date
  // Susan counts an instruction with no appraisal recorded against it as a
  // market appraisal, so the list has to say which half a row came from.
  kind: "appraisal" | "listing-only";
}

export interface FunnelRows {
  marketAppraisals: AppraisalsDrillRow[] | null;
  listings: ListingsDrillRow[] | null;
  moveIns: MoveInsDrillRow[] | null;
  pipeline: PipelineDrillRow[] | null;
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
  gciTarget: number | null;        // £ — the forecast £ figure for the month
  portfolioTarget: number | null;  // target managed-property count (portfolio-basis forecasting)
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
  /** A short "about me" the agent writes for themselves. */
  bio?: string | null;
  adsConnected?: boolean;          // agent linked their ads to the Ads app (My Ads)
  isAdmin?: boolean;               // derived server-side from ADMIN_EMAILS; never stored
  isPreTenancy?: boolean;          // derived server-side from PRETENANCY_EMAILS; never stored
  createdAt: string;
}

/* ------------------------- pre-tenancy deal overlay ------------------------- */
// Portal-side data layered on top of Propoly deals (lib/deal-store.ts):
// two-way notes between Kirstie (pre-tenancy) and the agent, her stage moves,
// and the pre-tenancy checklist. Keyed by the Propoly deal uuid.

export type DealNoteRole = "pretenancy" | "admin" | "agent";

/** note = shared activity · system = auto-logged event · private = author-only */
export type DealNoteKind = "note" | "system" | "private";

export interface DealNote {
  id: string;
  dealId: string;                  // Propoly deal uuid
  authorId: string;                // portal user id
  authorName: string;
  authorRole: DealNoteRole;
  kind?: DealNoteKind;             // absent = "note" (pre-existing rows)
  text: string;
  createdAt: string;               // ISO
}

/** A follow-up set against a deal (pre-tenancy Tasks tab / Tasks today). */
export interface DealTask {
  id: string;
  dealId: string;
  dealLabel: string;               // property name — shown in Tasks today
  userId: string;                  // owner (whoever set the follow-up)
  title: string;
  dueDate: string | null;          // "YYYY-MM-DD"
  done: boolean;
  createdAt: string;
  completedAt: string | null;
}

/** What the client may know about a connected mailbox (never the password). */
export interface MailboxStatus {
  connected: boolean;
  email?: string;
  imapHost?: string;
}

/** One email involving the deal's tenants, from the viewer's own mailbox. */
export interface DealEmail {
  id: string;
  subject: string;
  from: string;
  to: string;
  date: string | null;             // ISO
  direction: "in" | "out";         // relative to the connected mailbox
  body: string;                    // plain-text body (truncated)
}

export interface ChecklistTick {
  done: boolean;
  by: string;                      // display name
  at: string;                      // ISO
}

export interface DealMeta {
  /** Set when someone pulled this deal back out of the archive. Null means the
   *  archive rule applies normally. */
  unarchivedAt?: string | null;
  dealId: string;
  /** Propoly statusKey the deal was manually moved to (null = live status). */
  stageOverride: string | null;
  /** Live statusKey when the move was made — a later live change wins. */
  stageBasedOn: string | null;
  stageBy: string | null;
  stageAt: string | null;
  checklist: Record<string, ChecklistTick>; // key = CHECKLIST_ITEMS key
  /** Which scheme holds the deposit (from DEPOSIT_SCHEMES) — the portal IS
   *  the register for this; no upstream system records it. */
  depositScheme?: string | null;
  updatedAt: string;
}

/** What both dashboards render per deal: notes + effective stage + checklist. */
export interface DealPortalOverlay {
  notesCount: number;
  lastNote: { text: string; authorName: string; authorRole: DealNoteRole; at: string } | null;
  override: { stageKey: string; by: string; at: string } | null;
  checklistDone: number;
  checklistTotal: number;
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
