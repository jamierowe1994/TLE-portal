// SEED lane — lib/seed-data.ts
// Full transcription of Susan's TLE Business Dashboard (Base44),
// https://tle-business-dashboard.base44.app/Dashboard — captured 11 Jul 2026.
// Every StatValue here is source "snapshot", asOf 2026-07-11. Do not invent or round.
//
// NOTES FROM THE CAPTURE:
// - The Base44 "P&L" tab is password-protected and was NOT captured. The H2
//   reforecast below (from the Forecast tab) provides the P&L structure only.
// - Per-agent partnerType (TLE / TLE Dual / Lettings Lite) is NOT broken out
//   per agent anywhere in the snapshot — only headcount totals. ROSTER defaults
//   everyone to "TLE"; admin can correct individual agents later.
// - Viewings: KPI Overview funnel shows 46 for July MTD, the Agent Detail
//   per-agent table totals 28 — different report cuts on the source dashboard.

// SERVER-ONLY: the full seed contains tenant personal data (arrears) and
// owner-only business financials (P&L, partner net income). It must never be
// statically imported by a "use client" component — client code gets it via
// the admin-gated /api/admin/* routes. Client-safe pieces (ROSTER, name
// matching, SOURCES, snapshot constants) live in lib/roster.ts.
import "server-only";

import type { FunnelStats, StatValue } from "@/lib/types";
import type {
  AgentKpiRow,
  ArrearsAgingBucket,
  ArrearsTenantRow,
  BaselineCostRow,
  ComplianceAgentRow,
  ComplianceItemRow,
  ComplianceTypeRow,
  H2ReforecastRow,
  IncomeMonthlyRow,
  LicenceFeeRow,
  MoveInRow,
  PartnerNetIncomeRow,
  PipelineRow,
  PortfolioRow,
  YoYGrowthEntry,
} from "@/lib/seed-types";
import {
  ROSTER,
  SNAPSHOT_DATE,
  SNAPSHOT_NOTE,
  SOURCES,
  agentKeysForName,
  nameMatchesAgent,
} from "@/lib/roster";

// Re-export the client-safe pieces so existing server-side imports
// (`import { ROSTER } from "@/lib/seed-data"`) keep working.
export {
  ROSTER,
  SNAPSHOT_DATE,
  SNAPSHOT_NOTE,
  SOURCES,
  agentKeysForName,
  nameMatchesAgent,
};

/** Build a snapshot StatValue. `src` = the source line shown on the dashboard. */
function snap(value: number | null, display?: string, src?: string): StatValue {
  const note = src ? `${SNAPSHOT_NOTE} · Source: ${src}` : SNAPSHOT_NOTE;
  const stat: StatValue = { value, source: "snapshot", note, asOf: SNAPSHOT_DATE };
  if (display) stat.display = display;
  return stat;
}


/* ============================== SEED ============================== */

export const SEED = {
  /* ---- Tab 1: KPI Overview — header strip (JUN YTD) ---- */
  headline: {
    mas: snap(174, undefined, "REX KPI reports"),
    listings: snap(172, undefined, "REX KPI reports"),
    applications: snap(165, undefined, "REX KPI reports"),
    moveIns: snap(175, undefined, "Lettings Support - Move In Report"),
    gciExcVat: snap(213317, "£213,317", "E&W & Glasgow PayProp reports"),
    totalIncome: snap(240434, "£240,434", "E&W & Glasgow PayProp reports"),
    pipeline: snap(51, undefined, "REX KPI reports"),
    label: "Jun YTD",
    lastUpdated: "11 Jul 2026",
  },

  /* ---- Tab 1: Agent headcount — July 2026 ---- */
  headcount: {
    activeAgents: snap(30, undefined, "Agent Headcount report"),
    tle: snap(19, undefined, "Agent Headcount report"),
    tleDual: snap(8, undefined, "Agent Headcount report"),
    lettingsLite: snap(2, undefined, "Agent Headcount report"),
    startingSoon: snap(1, undefined, "Agent Headcount report"),
    startersYtd: snap(10, undefined, "Agent Headcount report (TLE / TLE Dual - excl Lettings Lite)"),
    leaversYtd: snap(7, undefined, "Agent Headcount report (TLE / TLE Dual - excl Lettings Lite)"),
    varianceYtd: snap(3, "+3", "Agent Headcount report (net change TLE / TLE Dual)"),
  },

  /* ---- Tab 1: Partner productivity & ramp time — July ---- */
  partnerRamp: {
    newStarters: snap(0, undefined, "Agent Headcount report · REX KPI reports"),
    maInMonths1To2: snap(null, "—", "No July starters · June cohort: Rovena Buci got MA in month 1"),
    listingInMonths1To2: snap(null, "—", "No July starters · Rovena Buci listed in month 1"),
    moveInWithin60Days: snap(null, "—", "No move-ins from June cohort yet"),
    note: "No new starters in July · Chanade Patrick starting Aug 2026 · June cohort now in month 2",
  },

  /* ---- Tab 1: Business KPIs — sales funnel, July MTD ---- */
  businessFunnel: {
    marketAppraisals: snap(10, undefined, "REX KPI reports"),
    listings: snap(9, undefined, "REX KPI reports"),
    viewings: snap(46, undefined, "REX KPI reports"),
    applications: snap(6, undefined, "REX KPI reports"),
    moveIns: snap(10, undefined, "Lettings Support - Move In Report"),
    pipeline: snap(51, undefined, "REX KPI reports (forward pipeline)"),
    liveListings: snap(28, undefined, "REX KPI reports"),
    gci: snap(12000, "£12,000", "£12,000 est combined exc VAT · 10 move-ins × £1,200 avg · preliminary · 9 Jul"),
  } satisfies FunnelStats,

  /* ---- Tab 1: Conversion rates — July MTD ---- */
  conversions: {
    maToListing: snap(90, "90%", "Derived from sales funnel — 9 listings from 10 combined MAs · 1 recorded + 9 listing-only · Jul MTD"),
    listingToMoveIn: snap(111, "111%", "Derived from sales funnel — 10 move-ins from 9 listings · Jul MTD · 6 Jul"),
    rlpConversion: snap(50, "50%", "5 of 10 EFM managed · Jul MTD preliminary"),
    gciPerMoveIn: snap(1200, "£1,200", "£12,000 est GCI ÷ 10 fee-generating MIs · Jul MTD preliminary"),
    gciPerAgent: snap(400, "£400", "£12,000 est GCI ÷ 30 partners · Jul MTD preliminary"),
  },

  /* ---- Tab 1: Market appraisals by partner type — July MTD ---- */
  masByPartnerType: {
    total: snap(10, undefined, "REX export · Agent Headcount export"),
    tle: snap(7, undefined, "REX export · Agent Headcount export"),
    tleDual: snap(3, undefined, "REX export · Agent Headcount export"),
    lettingsLite: snap(1, undefined, "REX export · Agent Headcount export"),
  },

  /* ---- Tab 1: Year on year growth ---- */
  yoyGrowth: [
    { label: "Partner count", from: 21, to: 30, stat: snap(30, "21 → 30", "+43% Mar 25 → May 26") },
    { label: "YTD move-ins", from: 82, to: 162, stat: snap(162, "82 → 162", "+98% Jan–Jun 25 vs Jan–Jun 26 · 23 Jun") },
    { label: "Total portfolio", from: 296, to: 500, stat: snap(500, "296 → 500", "+69% Mar 25 → May 26 · inc Glasgow") },
    { label: "GCI per move-in", from: 1603, to: 1136, stat: snap(1136, "£1,603 → £1,136", "2025 avg vs May 26 adj · excl transfers & Lianna") },
  ] satisfies YoYGrowthEntry[],

  /* ---- Tab 2: Paid leads & pro licence (GoHighLevel — no API access) ---- */
  paidLeads: {
    leadsGenerated: snap(180, undefined, "Go High Level"),
    referredToAgents: snap(3, undefined, "Go High Level"),
    masBooked: snap(2, undefined, "Go High Level"),
    leadToReferralPct: snap(1.7, "1.7%", "Go High Level"),
    leadToMaPct: snap(67, "67%", "Go High Level"),
    proLicenceIncome: snap(1500, "£1,500", "15 partners × £100+VAT/mth · Jul MTD preliminary"),
    ytdJoiningFees: snap(9000, "£9,000", "Joining fee = £1,000+VAT one-off · YTD joining fees received"),
    funnel: [
      { label: "Leads", value: 180 },
      { label: "Referred", value: 3 },
      { label: "MAs Booked", value: 2 },
    ],
    note: "Lead data from paid lead platform (Go High Level) · Pro licence = £100+VAT/month per partner · Joining fee = £1,000+VAT one-off",
  },

  /* ---- Tab 3: Move-ins & pipeline — header stats ---- */
  moveInHeader: {
    julyMtdCompleted: snap(10, undefined, "Lettings Support - Move In Report (6 new lets + 4 relets)"),
    julyMtdNewLets: snap(6, undefined, "Lettings Support - Move In Report (from move-in tracker)"),
    julyMtdRelets: snap(4, undefined, "Lettings Support - Move In Report (no man trans)"),
    julyRemainingPipeline: snap(26, undefined, "36 forecast · 10 complete · 26 remaining"),
    augSepPipeline: snap(25, undefined, "Forward forecast Aug–Sep 2026"),
    julyForecast: snap(36, undefined, "10 completed + 26 remaining"),
    q2TotalMoveIns: snap(110, undefined, "Apr 20 + May 60 + Jun 30 final"),
    ytdMoveIns: snap(185, undefined, "Q1 65 + Q2 110 + Jul 10 MTD"),
  },

  /* ---- Tab 3: Move-ins July (10 rows · total 12M cost value £5,659) ---- */
  moveInsJuly: {
    rows: [
      { agent: "Geraldine Mulhern", property: "7 Kynaston Crescent, Thornton Heath, CR7 7BS", applicationDate: null, moveInDate: "01 Jul 2026", letType: "New Let", serviceLevel: "Tenant Find", rentPcm: 2100, setupFee: 1500, monthlyMgmtFee: 0, twelveMonthValue: 1500 },
      { agent: "Rhiannon Dodge", property: "20 Queensway, Newton Abbot, TQ12 4BL", applicationDate: null, moveInDate: "01 Jul 2026", letType: "New Let", serviceLevel: "Tenant Find", rentPcm: 1150, setupFee: 479, monthlyMgmtFee: 0, twelveMonthValue: 479 },
      { agent: "Lianna Denholm", property: "12 Queens Gardens, St Andrews, KY16 9TA", applicationDate: null, moveInDate: "01 Jul 2026", letType: "Relet", serviceLevel: "EFM no RLP", rentPcm: 4300, setupFee: 0, monthlyMgmtFee: 258, twelveMonthValue: 258 },
      { agent: "Lianna Denholm", property: "42/6 Argyle Place, Edinburgh, EH3 9AR", applicationDate: null, moveInDate: "01 Jul 2026", letType: "Relet", serviceLevel: "EFM no RLP", rentPcm: 3250, setupFee: 0, monthlyMgmtFee: 195, twelveMonthValue: 195 },
      { agent: "Richard Callow", property: "43 Sandy Lane, Oxford, OX4 6AN", applicationDate: null, moveInDate: "01 Jul 2026", letType: "New Let", serviceLevel: "Tenant Find", rentPcm: 3000, setupFee: 750, monthlyMgmtFee: 0, twelveMonthValue: 750 },
      { agent: "Lauren Engley", property: "10 Highland Road, Bath, BA2 1DY", applicationDate: null, moveInDate: "01 Jul 2026", letType: "Relet", serviceLevel: "Tenant Find", rentPcm: 3000, setupFee: 1200, monthlyMgmtFee: 270, twelveMonthValue: 1470 },
      { agent: "James Crumpton", property: "27 Rock House, Bethel Road, Bristol, BS5 7NN", applicationDate: null, moveInDate: "01 Jul 2026", letType: "New Let", serviceLevel: "Tenant Find", rentPcm: 900, setupFee: 450, monthlyMgmtFee: 0, twelveMonthValue: 450 },
      { agent: "Rhiannon Dodge", property: "Room 4, 5a Newton Road, Kingskerswell, TQ12 5EQ", applicationDate: null, moveInDate: "08 Jul 2026", letType: "Relet", serviceLevel: "EFM with RLP", rentPcm: 750, setupFee: 350, monthlyMgmtFee: 75, twelveMonthValue: 425 },
      { agent: "Richard Callow", property: "7 Westrup Close, Oxford, OX3 0HZ", applicationDate: null, moveInDate: "10 Jul 2026", letType: "New Let", serviceLevel: "EFM no RLP", rentPcm: 1800, setupFee: 0, monthlyMgmtFee: 0, twelveMonthValue: 0 },
      { agent: "Richard Callow", property: "44 Glebe Way, Stowmarket, IP14 5TL", applicationDate: null, moveInDate: "10 Jul 2026", letType: "New Let", serviceLevel: "EFM no RLP", rentPcm: 1100, setupFee: 0, monthlyMgmtFee: 132, twelveMonthValue: 132 },
    ] satisfies MoveInRow[],
    totalTwelveMonthValue: snap(5659, "£5,659", "Lettings Support - Move In Report"),
  },

  /* ---- Tab 3: July pipeline — 26 properties (expected July move-ins) ---- */
  julyPipeline: [
    { agent: "Joe Patten", property: "Room 2, 32 Elm Close, Huntingdon, PE29 7AS", expectedMoveIn: "03 Jul 2026", serviceLevel: "Tenant Find", status: "PLC Sign Off", rentPcm: 550, period: "july" },
    { agent: "Lianna Denholm", property: "40 (1f2) Marchmont Crescent, Edinburgh, EH9 1HG", expectedMoveIn: "TBC", serviceLevel: "EFM no RLP", status: "Tenancy Generation", rentPcm: 4250, period: "july" },
    { agent: "Dan Richards", property: "8 95 Springthorpe Green, Birmingham, B24 0TW", expectedMoveIn: "TBC", serviceLevel: "EFM with RLP", status: "PLC Sign Off", rentPcm: 925, period: "july" },
    { agent: "Kirstie Wallington", property: "Flat 4, 28 Fosse Road South, Leicester, LE3 0QD", expectedMoveIn: "TBC", serviceLevel: "EFM no RLP", status: "Tenancy Generation", rentPcm: 670, period: "july" },
    { agent: "Sean McMahon", property: "141 St Leonards Street, Edinburgh, EH8 9RB", expectedMoveIn: "12 Jul 2026", serviceLevel: "Tenant Find", status: "PLC Sign Off", rentPcm: 950, period: "july" },
    { agent: "Sean McMahon", property: "32 Westerton Avenue, Larkhall, ML9 1JQ", expectedMoveIn: "12 Jul 2026", serviceLevel: "EFM with RLP", status: "PLC Sign Off", rentPcm: 650, period: "july" },
    { agent: "Sean McMahon", property: "2a Kings Court, Ayr, KA8 0AD", expectedMoveIn: "16 Jul 2026", serviceLevel: "EFM with RLP", status: "Tenancy Generation", rentPcm: 600, period: "july" },
    { agent: "Tony Poon", property: "49 Cedar Road, Oxford, OX2 9ED", expectedMoveIn: "24 Jul 2026", serviceLevel: "EFM with RLP", status: "PLC Sign Off", rentPcm: 1800, period: "july" },
    { agent: "Sean McMahon", property: "Flat 5, 35 McDonald Road, Edinburgh, EH7 4LY", expectedMoveIn: "27 Jul 2026", serviceLevel: "Tenant Find", status: "Signing and Move in Monies", rentPcm: 1600, period: "july" },
    { agent: "Sean McMahon", property: "11 Albion Street, Motherwell, ML1 1XJ", expectedMoveIn: "27 Jul 2026", serviceLevel: "EFM with RLP", status: "PLC Sign Off", rentPcm: 700, period: "july" },
    { agent: "Rhiannon Dodge", property: "Flat 9, Riva House, Dawlish, EX7 9HR", expectedMoveIn: "30 Jul 2026", serviceLevel: "Tenant Find", status: "PLC Sign Off", rentPcm: 850, period: "july" },
    { agent: "Rhiannon Dodge", property: "Steps Cottage, 2 Iddesleigh Terrace, Dawlish, EX7 9HS", expectedMoveIn: "31 Jul 2026", serviceLevel: "EFM no RLP", status: "PLC Sign Off", rentPcm: 795, period: "july" },
    { agent: "Lianna Denholm", property: "5 Douglas Gardens Mews, Edinburgh, EH4 3BZ", expectedMoveIn: "08 Jul 2026", serviceLevel: "EFM no RLP", status: "Awaiting References", rentPcm: 2600, period: "july" },
    { agent: "Lianna Denholm", property: "The Doo'cot, Mansefield House, Callander, FK17 8BL", expectedMoveIn: "09 Jul 2026", serviceLevel: "EFM no RLP", status: "Awaiting References", rentPcm: 595, period: "july" },
    { agent: "Rhiannon Dodge", property: "Flat 3, 15 Marine Parade, Dawlish, EX7 9DL", expectedMoveIn: "18 Jul 2026", serviceLevel: "EFM with RLP", status: "Awaiting References", rentPcm: 725, period: "july" },
    { agent: "Kayleigh Wright", property: "Flat 1, 11 Station Road, Liverpool, L34 5SN", expectedMoveIn: "14 Jul 2026", serviceLevel: "EFM with RLP", status: "Awaiting References", rentPcm: 725, period: "july" },
    { agent: "Stuart Roper", property: "First Floor Flat, 130 Chesterfield Road, Bristol, BS16", expectedMoveIn: "TBC", serviceLevel: "EFM with RLP", status: "Awaiting References", rentPcm: 3100, period: "july" },
    { agent: "Stuart Roper", property: "127 Forest Road, Fishponds, Bristol, BS16 3ST", expectedMoveIn: "TBC", serviceLevel: "EFM with RLP", status: "Awaiting References", rentPcm: 2600, period: "july" },
    { agent: "Kayleigh Wright", property: "Flat 3, 11 Station Road, Prescot, L34 5SN", expectedMoveIn: "26 Jul 2026", serviceLevel: "EFM with RLP", status: "Awaiting References", rentPcm: 795, period: "july" },
    { agent: "Bernadine Williams", property: "4 Bowerman Court, Watford, WD19", expectedMoveIn: "29 Jul 2026", serviceLevel: "EFM no RLP", status: "Awaiting References", rentPcm: 1500, period: "july" },
    { agent: "Sean McMahon", property: "89/1 Restalrig Road South, Edinburgh, EH7", expectedMoveIn: "28 Jul 2026", serviceLevel: "EFM with RLP", status: "Awaiting References", rentPcm: 950, period: "july" },
    { agent: "Joe Patten", property: "Room 3, 2 Norwich Street, Wisbech, PE13 2LE", expectedMoveIn: "TBC", serviceLevel: "EFM no RLP", status: "PLC Sign Off", rentPcm: 550, period: "july" },
    { agent: "Dan Richards", property: "15 Roxby Gardens, Wolverhampton, WV6 0TL", expectedMoveIn: "TBC", serviceLevel: "Tenant Find", status: "Awaiting References", rentPcm: 1200, period: "july" },
    { agent: "Lianna Denholm", property: "17/7 Upper Grove Place, Edinburgh, EH3 8AX", expectedMoveIn: "TBC", serviceLevel: "EFM no RLP", status: "PLC Sign Off", rentPcm: 4000, period: "july" },
    { agent: "Rhiannon Dodge", property: "Room 2, 66 Fore Street, Kingsteignton, TQ12 3AU", expectedMoveIn: "TBC", serviceLevel: "EFM no RLP", status: "Signing and Move in Monies", rentPcm: 625, period: "july" },
    { agent: "Sean McMahon", property: "9 Duntreath Place, Edinburgh, EH16 4ZA", expectedMoveIn: "TBC", serviceLevel: "EFM no RLP", status: "Awaiting References", rentPcm: 1650, period: "july" },
  ] satisfies PipelineRow[],

  /* ---- Tab 3: Forward pipeline — Aug–Sep · 25 properties ---- */
  forwardPipeline: [
    { agent: "Kayleigh Wright", property: "Flat 2, 11 Station Road, Liverpool, L34 5SN", expectedMoveIn: "01 Aug 2026", serviceLevel: "EFM with RLP", status: "Awaiting References", rentPcm: 680, period: "aug-sep" },
    { agent: "Tony Poon", property: "Flat 64, Dara House, London, NW9 0BR", expectedMoveIn: "01 Aug 2026", serviceLevel: "Tenant Find", status: "Awaiting References", rentPcm: 2000, period: "aug-sep" },
    { agent: "Tony Poon", property: "15a Crowborough Lane, Milton Keynes, MK7", expectedMoveIn: "01 Aug 2026", serviceLevel: "EFM with RLP", status: "Awaiting References", rentPcm: 2300, period: "aug-sep" },
    { agent: "Richard Callow", property: "Room 3, 32 Waylen Street, Reading, RG1 7UR", expectedMoveIn: "01 Aug 2026", serviceLevel: "EFM with RLP", status: "Awaiting References", rentPcm: 725, period: "aug-sep" },
    { agent: "Lauren Engley", property: "160 Gloucester Road, Bristol, BS34 5BQ", expectedMoveIn: "03 Aug 2026", serviceLevel: "Tenant Find", status: "Awaiting References", rentPcm: 2900, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 1, 52 Sunflower Road, Emersons Green, Bristol, BS16", expectedMoveIn: "09 Aug 2026", serviceLevel: "EFM no RLP", status: "Awaiting References", rentPcm: 800, period: "aug-sep" },
    { agent: "Richard Callow", property: "73 Horspath Road, Oxford, OX4 2QP", expectedMoveIn: "09 Aug 2026", serviceLevel: "Tenant Find", status: "Awaiting References", rentPcm: 3300, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 5, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "14 Aug 2026", serviceLevel: "Tenant Find", status: "PLC Sign Off", rentPcm: 795, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 25, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "15 Aug 2026", serviceLevel: "Tenant Find", status: "PLC Sign Off", rentPcm: 795, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 52, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "15 Aug 2026", serviceLevel: "Tenant Find", status: "Awaiting References", rentPcm: 795, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 31, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "15 Aug 2026", serviceLevel: "Tenant Find", status: "Awaiting References", rentPcm: 795, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 54, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "15 Aug 2026", serviceLevel: "Tenant Find", status: "Awaiting References", rentPcm: 895, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 50, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "16 Aug 2026", serviceLevel: "Tenant Find", status: "Awaiting References", rentPcm: 795, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 67, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "15 Aug 2026", serviceLevel: "Tenant Find", status: "PLC Sign Off", rentPcm: 795, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 38, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "15 Aug 2026", serviceLevel: "Tenant Find", status: "PLC Sign Off", rentPcm: 795, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 27, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "15 Aug 2026", serviceLevel: "Tenant Find", status: "PLC Sign Off", rentPcm: 795, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 10, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "15 Aug 2026", serviceLevel: "Tenant Find", status: "Awaiting References", rentPcm: 795, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 68, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "29 Aug 2026", serviceLevel: "Tenant Find", status: "PLC Sign Off", rentPcm: 795, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 69, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "26 Aug 2026", serviceLevel: "Tenant Find", status: "Awaiting References", rentPcm: 795, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 3, 52 Sunflower Road, Emersons Green, Bristol, BS16", expectedMoveIn: "24 Aug 2026", serviceLevel: "EFM no RLP", status: "Awaiting References", rentPcm: 800, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 40, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "01 Sep 2026", serviceLevel: "Tenant Find", status: "Awaiting References", rentPcm: 795, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 20, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "01 Sep 2026", serviceLevel: "Tenant Find", status: "Awaiting References", rentPcm: 795, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 36, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "01 Sep 2026", serviceLevel: "Tenant Find", status: "Awaiting References", rentPcm: 795, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 46, 166 Gloucester Road North, Filton, BS34 7QA", expectedMoveIn: "17 Sep 2026", serviceLevel: "Tenant Find", status: "Awaiting References", rentPcm: 795, period: "aug-sep" },
    { agent: "Lauren Engley", property: "Room 65, 166 Gloucester Road, Filton, Bristol, BS34", expectedMoveIn: "01 Sep 2026", serviceLevel: "Tenant Find", status: "Awaiting References", rentPcm: 795, period: "aug-sep" },
  ] satisfies PipelineRow[],

  /* ---- Tab 4: Income ---- */
  income: {
    julyMtd: {
      eAndWGci: snap(10000, "£10,000", "Estimated · pending Payprop report · net exc VAT"),
      glasgowGci: snap(2000, "£2,000", "Estimated · pending Glasgow fees report · net exc VAT"),
      combinedGci: snap(12000, "£12,000", "Preliminary · 10 move-ins × £1,200 avg · 9 Jul"),
      tleNetIncome: snap(4800, "£4,800", "Estimated · 40% of combined GCI · preliminary"),
      paidToAssociates: snap(5400, "£5,400", "Estimated · 60% of net · preliminary · E&W"),
      juneFinalGci: snap(39609, "£39,609", "Previous month · E&W + Glasgow · final"),
      splitNote: "TLE £4,800 (47%) · Associates £5,400 (53%) · Combined GCI £12,000 est · Preliminary, awaiting Payprop reports for final figures",
    },
    june: {
      totalGci: snap(39609, "£39,609", "E&W £34,532 + Glasgow £5,077 · net exc VAT · combined final"),
      totalIncome: snap(44309, "£44,309", "Combined GCI £39,609 + monthly £1,950 + pro £1,500 + joining £1,250"),
      gciPerAgent: snap(1320, "£1,320", "£39,609 ÷ 30 partners"),
      netIncomePerAgent: snap(533, "£533", "TLE net £15,982 ÷ 30"),
      monthlyLicence: snap(1950, "£1,950", "June monthly licence · £4,700 total less pro £1,500 less joining £1,250"),
      proLicence: snap(1500, "£1,500", "15 partners × £100 exc VAT"),
      joiningFees: snap(1250, "£1,250", "2 starters Jun · Simon Fan £1,000 + Rovena Buci £250 (TPE reduced fee) · Chanade Patrick £1,000 not yet received"),
      eAndWGci: snap(34532, "£34,532", "E&W + Edinburgh (Lianna Denholm) · net exc VAT · mgmt £24,619 + set-up £7,345 + other £2,568 · Summary of Fees"),
      glasgowGci: snap(5077, "£5,077", "Sean McMahon · Glasgow fees report · man fees £4,267 + other £810 · net exc VAT"),
      tleNetIncome: snap(15982, "£15,982", "E&W £11,352 + Glasgow £4,630 · combined Net Income to TLE after Payprop chgs"),
      partnerNetIncome: snap(17686, "£17,686", "E&W associates only · Glasgow has 0 paid to associates · net exc VAT · Agent Earnings Table"),
      tleSplitPct: snap(47, "47%", "TLE / Partner split (E&W GCI): TLE 47% / Partners 53% (£15,982 TLE · £17,686 partners)"),
      partnerSplitPct: snap(53, "53%", "TLE / Partner split (E&W GCI): TLE 47% / Partners 53% (£15,982 TLE · £17,686 partners)"),
    },
    // TLE Business Income — Jan–Jun 2026 (all fees exc VAT · E&W from Summary of Fees + Glasgow from Glasgow fees report)
    monthlyTable: [
      { metric: "E&W management fees", jan: 17398, feb: 17838, mar: 23266, q1: 58502, apr: 19558, may: 18126, jun: 24619, q2: 62303, ytd: 120805 },
      { metric: "E&W set up fees", jan: 6710, feb: 7600, mar: 12882, q1: 27192, apr: 10188, may: 15843, jun: 7345, q2: 33376, ytd: 60568 },
      { metric: "E&W other fees", jan: 548, feb: 293, mar: 1184, q1: 2025, apr: 1074, may: 0, jun: 2568, q2: 3642, ytd: 5667 },
      { metric: "E&W GCI (exc VAT)", jan: 24656, feb: 25731, mar: 37332, q1: 87719, apr: 30820, may: 33969, jun: 34532, q2: 99321, ytd: 187040 },
      { metric: "Glasgow GCI (exc VAT)", jan: 4394, feb: 3253, mar: 4381, q1: 12028, apr: 4269, may: 4903, jun: 5077, q2: 14249, ytd: 26277 },
      { metric: "Combined GCI (exc VAT)", jan: 29050, feb: 28984, mar: 41713, q1: 99747, apr: 35089, may: 38872, jun: 39609, q2: 113570, ytd: 213317 },
      { metric: "Paid to Associates (E&W)", jan: 11475, feb: 12889, mar: 18775, q1: 43139, apr: 15587, may: 16826, jun: 17686, q2: 50099, ytd: 93238 },
      { metric: "Combined Net Income to TLE", jan: 13471, feb: 12885, mar: 16935, q1: 43291, apr: 14451, may: 16491, jun: 15982, q2: 46924, ytd: 90216 },
      { metric: "Monthly licence fees", jan: 3967, feb: 3800, mar: 2600, q1: 10367, apr: 3500, may: -1350, jun: 1950, q2: 4100, ytd: 14467 },
      { metric: "Pro licence fees", jan: 300, feb: 300, mar: 300, q1: 900, apr: null, may: null, jun: 1500, q2: 1500, ytd: 2400 },
      { metric: "Joining fees", jan: 2000, feb: 2000, mar: 4000, q1: 8000, apr: 1000, may: null, jun: 1250, q2: 2250, ytd: 10250 },
      { metric: "Total Licence Income", jan: 6267, feb: 6100, mar: 6900, q1: 19267, apr: 4500, may: -1350, jun: 4700, q2: 7850, ytd: 27117 },
      { metric: "TOTAL INCOME", jan: 35317, feb: 35084, mar: 48613, q1: 119014, apr: 39589, may: 37522, jun: 44309, q2: 121420, ytd: 240434 },
    ] satisfies IncomeMonthlyRow[],
    licenceFeeTable: [
      { month: "January", monthlyLicence: 3967, proLicence: 300, joiningFees: 2000, total: 6267 },
      { month: "February", monthlyLicence: 3800, proLicence: 300, joiningFees: 2000, total: 6100 },
      { month: "March", monthlyLicence: 2600, proLicence: 300, joiningFees: 4000, total: 6900 },
      { month: "April", monthlyLicence: 3500, proLicence: null, joiningFees: 1000, total: 4500 },
      { month: "May", monthlyLicence: -1350, proLicence: null, joiningFees: null, total: -1350 },
      { month: "June", monthlyLicence: 1950, proLicence: 1500, joiningFees: 1250, total: 4700 },
      { month: "YTD Total", monthlyLicence: 14467, proLicence: 2400, joiningFees: 10250, total: 27117 },
    ] satisfies LicenceFeeRow[],
    // Year on Year — Gross GCI exc VAT growth %
    yoyGrowthPct: {
      "2024to2025": { Jan: 28, Feb: 146, Mar: 185, Apr: 64, May: 73, Jun: 168, Jul: 85, Aug: 213, Sep: 110, Oct: 42, Nov: 56, Dec: 17 } as Record<string, number>,
      "2025to2026": { Jan: 80, Feb: 7, Mar: 57, Apr: 40, May: 33, Jun: 39 } as Record<string, number>,
    },
    modelNote:
      "GCI split roughly TLE 40-47% / Partners 53-60% on E&W; Glasgow (Sean McMahon) pays 0 to associates; licence income = monthly licence + pro licence (£100+VAT × 15 partners) + joining fees (£1,000+VAT). PayProp is the source for GCI actuals (not yet accessible — PayProp pending).",
  },

  /* ---- Tab 6 (Forecast): Business value — monthly rent roll & recurring income ---- */
  businessValue: {
    monthlyRentRoll: snap(357431, "£357,431", "E&W & Glasgow PayProp portfolio reports (362 managed properties)"),
    monthlyManagementFees: snap(28886, "£28,886", "E&W £24,619 · Glasgow £4,267"),
    mri: snap(32336, "£32,336", "MRI — monthly recurring income · Mgmt £28,886 + lic £3,450 · Core £1,950 · Pro £1,500"),
    oneOffFees: snap(11973, "£11,973", "Set-up & other £10,723 + joining £1,250 · 6-mo avg £12,507"),
    totalMonthlyIncome: snap(44309, "£44,309", "MRI £32,336 + one-off £11,973 · matches Income tab"),
    tradingPartners: snap(21, undefined, "21 trading · 30 active · June 2026"),
    mriPerProperty: snap(89, "£89", "÷ 362 managed · avg rent £987"),
    mriPctPerProperty: snap(9.0, "9.0%", "MRI as % of rent roll"),
    mriPerTradingPartner: snap(1540, "£1,540", "MRI ÷ 21 trading partners"),
    mriSplitTle: snap(19432, "£19,432", "MRI split — TLE retained"),
    mriSplitPartner: snap(12904, "£12,904", "MRI split — Partner"),
    glasgowNote:
      "Glasgow's lower rents and smaller management fee yield mean its per-property MRI is materially below E&W and pulls blended figures down.",
    // Baseline costs vs income (May 2026 cost actuals)
    monthlyGap: snap(17279, "£17,279", "Recurring GP £15,105 + One-off £5,577 − Baseline £37,961"),
    costCoveragePct: snap(54, "54%", "of baseline covered by total income"),
    oneOffIncome: {
      setupAndOtherTleShare: snap(4327, "£4,327", "Set-up & other fees (TLE share)"),
      partnerJoiningFees: snap(1250, "£1,250", "Partner joining fees"),
      total: snap(5577, "£5,577", "Total one-off / non-recurring income (monthly)"),
    },
    forecast750Note:
      "Forecast at 750 units: recurring £31,296 + one-off £10,214 = £41,510 total vs £37,961 baseline → surplus £3,549",
    baselineCosts: {
      direct: [
        { label: "Referencing / FPP fee", value: 3508 },
        { label: "RPI premium", value: 2474 },
      ] satisfies BaselineCostRow[],
      directSubtotal: snap(5982, "£5,982", "Direct / variable costs subtotal · May 2026 cost actuals"),
      fixed: [
        { label: "Group admin & expenses (inc consultancy)", value: 13646 },
        { label: "Advertising & promotion", value: 9133 },
        { label: "Recruitment fees", value: 2840 },
        { label: "Operating software", value: 2190 },
        { label: "Property software", value: 865 },
        { label: "Staff training", value: 800 },
        { label: "Telephone", value: 956 },
        { label: "Subscriptions", value: 313 },
        { label: "Computer expenses", value: 830 },
        { label: "Insurance", value: 196 },
        { label: "Accountancy", value: 187 },
        { label: "Bank charges", value: 23 },
        { label: "Travel expenses", value: 0 },
      ] satisfies BaselineCostRow[],
      fixedSubtotal: snap(31979, "£31,979", "Fixed operational costs subtotal · May 2026 cost actuals"),
      total: snap(37961, "£37,961", "Total baseline costs / month"),
    },
  },

  /* ---- Tab 5 (Forecast tab): H2 2026 Reforecast — month-by-month P&L ---- */
  // NOTE: the dashboard's separate "P&L" tab is password-protected — not captured.
  h2Reforecast: {
    months: ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    rows: [
      { key: "managedProperties", label: "Managed Properties", kind: "count", values: [329, 343, 360, 376, 393, 401], h2Total: 401 },
      { key: "coreTleAgents", label: "Core TLE Agents", kind: "count", values: [26, 29, 31, 32, 33, 34], h2Total: 34 },
      { key: "starters", label: "Starters", kind: "count", values: [0, 4, 3, 3, 3, 3], h2Total: 16 },
      { key: "leavers", label: "Leavers", kind: "count", values: [-1, -1, -1, -2, -2, -2], h2Total: -9 },
      { key: "managementFees", label: "Management Fees (inc RLP)", kind: "currency", values: [29203, 30502, 32001, 33422, 34944, 35610], h2Total: 195682 },
      { key: "licenceFees", label: "Licence Fees", kind: "currency", values: [3120, 3480, 3720, 3840, 3960, 4080], h2Total: 22200 },
      { key: "joiningFees", label: "Joining Fees", kind: "currency", values: [0, 4000, 3000, 3000, 3000, 3000], h2Total: 16000 },
      { key: "otherFees", label: "Other Fees (LO + Set Up + Trans)", kind: "currency", values: [12812, 14267, 15236, 15722, 16207, 12280], h2Total: 86524 },
      { key: "totalIncome", label: "Total Income", kind: "currency", values: [45135, 52249, 53957, 55984, 58111, 54970], h2Total: 320406 },
      { key: "agentCommissions", label: "Agent Commissions", kind: "currency", values: [-28088, -29880, -31517, -32806, -34165, -32283], h2Total: -188739 },
      { key: "grossProfit", label: "Gross Profit", kind: "currency", values: [17046, 22369, 22441, 23178, 23946, 22686], h2Total: 131666 },
      { key: "gpPct", label: "GP %", kind: "pct", values: [37.8, 42.8, 41.6, 41.4, 41.2, 41.3], h2Total: 41.1 },
      { key: "opex", label: "Operating Expenditure", kind: "currency", values: [23737, 29141, 28243, 28461, 28687, 28215], h2Total: 166484 },
      { key: "netProfit", label: "Net Profit / (Loss)", kind: "currency", values: [-6691, -6772, -5802, -5283, -4741, -5529], h2Total: -34818 },
      { key: "cumulativeYtd", label: "Cumulative YTD", kind: "currency", values: [-63571, -70343, -76146, -81429, -86171, -91700], h2Total: -91700 },
    ] satisfies H2ReforecastRow[],
    h2NetLoss: snap(-34818, "(£34,818)", "H2 2026 Reforecast (19th Nov 25 draft)"),
    cumulativeYtdDec: snap(-91700, "(£91,700)", "H2 2026 Reforecast (19th Nov 25 draft)"),
    breakEvenNote: "Break-even: NOT in 2026 — requires ~500+ managed properties at current cost structure",
    assumptions:
      "Avg rent £987 · Mgmt fee 9% (inc RLP) · Core TLE agents only (excl Lettings Lite) · Agent commissions ~70% of fee income · RLP insurance cost within operating expenditure",
    sourceNote:
      "H2 2026 Reforecast (19th Nov 25 draft). The Base44 P&L tab is password-protected — source P&L figures pending.",
  },

  /* ---- Tab 6: Agent Detail — network health + tier counts (July MTD) ---- */
  networkHealth: {
    avgGciPerPartner: snap(null, "—", "0 active GCI earners · Jul MTD"),
    medianGciPerPartner: snap(null, "—", "Jul MTD"),
    netRetainedIncomePerPartner: snap(null, "—", "Partner net from fee report"),
    grossProfitPerPartner: snap(null, "—", "TLE net income per partner"),
    managedPropertiesPerPartner: snap(null, "—", "Pending portfolio snapshot"),
    moveInsPerPartner: snap(null, "—", "Jul MTD"),
    listingsPerPartner: snap(9.0, "9.0", "of 9 listings · Jul MTD"),
    activeGciEarners: snap(0, undefined, "Jul MTD"),
    totalNetworkGci: snap(0, "£0", "Jul MTD"),
    totalListings: snap(9, undefined, "Jul MTD"),
    tierCounts: {
      top: snap(0, undefined, "TOP TIER £3,000+ GCI/mo"),
      mid: snap(0, undefined, "MID TIER £1,000–£2,999"),
      dev: snap(12, undefined, "DEV TIER < £1,000"),
      newAgents: snap(0, undefined, "NEW AGENTS month 1–3"),
    },
  },

  /* ---- Tab 6: Per-agent KPI table (July MTD) ---- */
  // MA=market appraisals, Li=listings, Vw=viewings, Ap=applications, MI=move-ins, Pn=pipeline
  // NOTE: viewings here total 28 vs 46 on the KPI Overview funnel — different report cuts on the source.
  agentKpisJulyMtd: {
    rows: [
      { tier: "DEV", agent: "Sean McMahon (Edinburgh)", gci: null, ma: 1, li: 0, vw: 12, ap: 5, mi: null, pn: 7 },
      { tier: "DEV", agent: "Lauren Engley", gci: null, ma: 6, li: 6, vw: 3, ap: null, mi: null, pn: null },
      { tier: "DEV", agent: "Rhiannon Dodge", gci: null, ma: 0, li: 0, vw: 4, ap: 3, mi: null, pn: 4 },
      { tier: "DEV", agent: "Bernadine Williams", gci: null, ma: 1, li: 1, vw: 3, ap: 1, mi: null, pn: 1 },
      { tier: "DEV", agent: "Joe Patten", gci: null, ma: 0, li: 0, vw: 2, ap: 2, mi: null, pn: 2 },
      { tier: "DEV", agent: "Stuart Roper", gci: null, ma: 0, li: 0, vw: 1, ap: 2, mi: null, pn: 2 },
      { tier: "DEV", agent: "Shane Yu", gci: null, ma: 0, li: 0, vw: 1, ap: null, mi: null, pn: null },
      { tier: "DEV", agent: "Kirstie Wallington", gci: null, ma: 0, li: 0, vw: 1, ap: null, mi: null, pn: 1 },
      { tier: "DEV", agent: "Lianna Denholm", gci: null, ma: 0, li: 0, vw: 1, ap: 2, mi: null, pn: 3 },
      { tier: "DEV", agent: "Graham Cross", gci: null, ma: 1, li: 1, vw: null, ap: null, mi: null, pn: null },
      { tier: "DEV", agent: "Rebecca Adams", gci: null, ma: 1, li: 1, vw: null, ap: null, mi: null, pn: null },
      { tier: "DEV", agent: "Sean Mc Mahon (Glasgow)", gci: null, ma: null, li: null, vw: null, ap: null, mi: null, pn: null },
    ] satisfies AgentKpiRow[],
    totals: { tier: "TOTAL", agent: "", gci: null, ma: 10, li: 9, vw: 28, ap: 15, mi: 0, pn: 20 } satisfies AgentKpiRow,
    source: "Agent Headcount report & REX KPI reports & Finance monthly summary fee report",
  },

  /* ---- Tab 6: Partner net income — YTD 2026 ---- */
  // † Glasgow (Margo Wilson Jan–Apr · Sean Mc Mahon from May): 70% of GCI less
  //   £50+VAT per move-in (transaction fee) and £150+VAT per month (licence fee)
  partnerNetIncome: {
    rows: [
      { agent: "Rhiannon Dodge", jan: 1956, feb: 2851, mar: 3105, apr: 2719, may: 2429, jun: 3007, ytdTotal: 16067 },
      { agent: "Bernadine Williams", jan: 1125, feb: 1268, mar: 2664, apr: 2739, may: 1062, jun: 1343, ytdTotal: 10202 },
      { agent: "Joe Patten", jan: 1193, feb: 1279, mar: 3635, apr: 1585, may: 1574, jun: 1420, ytdTotal: 10687 },
      { agent: "James Crumpton", jan: 1506, feb: 2026, mar: 1281, apr: 2397, may: 1459, jun: 1426, ytdTotal: 10094 },
      { agent: "Sean McMahon (Edinburgh)", jan: 1287, feb: 1697, mar: 1815, apr: 2188, may: 1691, jun: 2347, ytdTotal: 11026 },
      { agent: "Tony Poon", jan: 1304, feb: 658, mar: 1125, apr: 861, may: 1168, jun: 1112, ytdTotal: 6228 },
      { agent: "Dan Richards", jan: 789, feb: 645, mar: 908, apr: 503, may: 673, jun: 390, ytdTotal: 3908 },
      { agent: "Claire Riley", jan: 514, feb: 667, mar: 717, apr: 717, may: 628, jun: 632, ytdTotal: 3876 },
      { agent: "Kirstie Wallington", jan: 312, feb: 323, mar: 633, apr: 626, may: 363, jun: 352, ytdTotal: 2609 },
      { agent: "Graham Cross", jan: 277, feb: 523, mar: 312, apr: 312, may: 312, jun: 399, ytdTotal: 2134 },
      { agent: "Kayleigh Wright", jan: null, feb: null, mar: 684, apr: 522, may: 828, jun: 475, ytdTotal: 2509 },
      { agent: "Chris Wilson-Slight", jan: 336, feb: 368, mar: 184, apr: 184, may: 365, jun: 215, ytdTotal: 1653 },
      { agent: "Stuart Roper", jan: 315, feb: 315, mar: 327, apr: 73, may: 73, jun: 395, ytdTotal: 1497 },
      { agent: "Geraldine Mulhern", jan: null, feb: null, mar: 825, apr: null, may: null, jun: 753, ytdTotal: 1578 },
      { agent: "Rebecca Adams", jan: 160, feb: 160, mar: 160, apr: 160, may: 160, jun: 110, ytdTotal: 908 },
      { agent: "Richard Callow", jan: null, feb: null, mar: 329, apr: null, may: 462, jun: 440, ytdTotal: 1231 },
      { agent: "David Quigg", jan: 206, feb: null, mar: null, apr: null, may: null, jun: null, ytdTotal: 206 },
      { agent: "Brian Hankins-Lewis", jan: 28, feb: 38, mar: null, apr: null, may: null, jun: null, ytdTotal: 66 },
      { agent: "Lianna Denholm", tag: "NEW", jan: null, feb: null, mar: null, apr: null, may: 2327, jun: 2700, ytdTotal: 5027 },
      { agent: "Paul Doig", tag: "NEW", jan: null, feb: null, mar: null, apr: null, may: 449, jun: null, ytdTotal: 449 },
      { agent: "Zilvinas Navickis", tag: "NEW", jan: null, feb: null, mar: null, apr: null, may: null, jun: 96, ytdTotal: 96 },
      { agent: "Lauren Engley", tag: "NEW", jan: null, feb: null, mar: null, apr: null, may: 392, jun: 77, ytdTotal: 469 },
      { agent: "Sean Mc Mahon (Glasgow)", tag: "GLASGOW", jan: 2601, feb: 1863, mar: 2589, apr: 3189, may: 3379, jun: 3554, ytdTotal: 17175 },
      { agent: "TLE Central", tag: "TLE", jan: 1628, feb: 1248, mar: 1882, apr: 2062, may: 1621, jun: 1729, ytdTotal: 10170 },
    ] satisfies PartnerNetIncomeRow[],
    eAndWTotal: { agent: "E&W Total", jan: 11475, feb: 12889, mar: 18775, apr: 15587, may: 16826, jun: 17686, ytdTotal: 93238 } satisfies PartnerNetIncomeRow,
    glasgowNote:
      "† Glasgow (Margo Wilson Jan–Apr · Sean Mc Mahon from May): 70% of GCI less £50+VAT per move-in (transaction fee) and £150+VAT per month (licence fee)",
    source: "Net commission paid to partners · exc VAT · from monthly fee report",
  },

  /* ---- Tab 7: Portfolio (PayProp-sourced — no API access yet) ---- */
  portfolio: {
    overview: {
      eAndWTotal: snap(442, undefined, "E&W & Glasgow PayProp portfolio report"),
      glasgowTotal: snap(83, undefined, "E&W & Glasgow PayProp portfolio report"),
      total: snap(528, undefined, "E&W & Glasgow PayProp portfolio report"),
      eAndWManaged: snap(279, undefined, "E&W & Glasgow PayProp portfolio report"),
      glasgowManaged: snap(83, undefined, "E&W & Glasgow PayProp portfolio report"),
      eAndWLetOnly: snap(163, undefined, "E&W & Glasgow PayProp portfolio report"),
      glasgowLetOnly: snap(0, undefined, "E&W & Glasgow PayProp portfolio report"),
      totalManaged: snap(362, undefined, "E&W & Glasgow PayProp portfolio report"),
      // Managed — rent protection breakdown
      noProtection: snap(231, undefined, "PayProp portfolio report — managed rent protection breakdown"),
      withRlp: snap(123, undefined, "PayProp portfolio report — managed rent protection breakdown"),
      withLec: snap(8, undefined, "PayProp portfolio report — managed rent protection breakdown"),
      protectedPct: snap(36, "36%", "PayProp portfolio report — managed rent protection breakdown"),
      avgRentEAndW: snap(1143, "£1,143", "PayProp portfolio report"),
      avgRentGlasgow: snap(465, "£465", "PayProp portfolio report"),
      vacant: snap(8, undefined, "PayProp portfolio report — health"),
      renewals: snap(12, undefined, "PayProp portfolio report — health"),
      arrears: snap(37, undefined, "PayProp portfolio report — health"),
      rentRollEAndW: snap(318806, "£318,806", "PayProp portfolio report — monthly rent roll"),
      rentRollGlasgow: snap(38625, "£38,625", "PayProp portfolio report — monthly rent roll"),
      rentRollTotal: snap(357431, "£357,431", "PayProp portfolio report — monthly rent roll"),
    },
    // Portfolio by partner — June 2026 · Managed = EFM with & without RLP/LEC + Rent Collect · RLP column includes LEC
    byPartner: [
      { agent: "Sean Mc Mahon (Glasgow)", managed: 83, letOnly: 0, total: 83, rlpLec: 13, rentRoll: 38625, avgRent: 465 },
      { agent: "Rhiannon Dodge", managed: 51, letOnly: 21, total: 72, rlpLec: 36, rentRoll: 47335, avgRent: 928 },
      { agent: "Joe Patten", managed: 47, letOnly: 7, total: 54, rlpLec: 4, rentRoll: 41787, avgRent: 889 },
      { agent: "Lianna Denholm", managed: 32, letOnly: 0, total: 32, rlpLec: 0, rentRoll: 32590, avgRent: 1018 },
      { agent: "James Crumpton", managed: 21, letOnly: 21, total: 42, rlpLec: 12, rentRoll: 28395, avgRent: 1352 },
      { agent: "Sean McMahon (Edinburgh)", managed: 18, letOnly: 37, total: 55, rlpLec: 7, rentRoll: 22750, avgRent: 1264 },
      { agent: "Bernadine Williams", managed: 16, letOnly: 13, total: 29, rlpLec: 1, rentRoll: 24225, avgRent: 1514 },
      { agent: "Tony Poon", managed: 13, letOnly: 2, total: 15, rlpLec: 12, rentRoll: 25920, avgRent: 1994 },
      { agent: "Dan Richards", managed: 12, letOnly: 14, total: 26, rlpLec: 5, rentRoll: 12600, avgRent: 1050 },
      { agent: "Claire Riley", managed: 10, letOnly: 2, total: 12, rlpLec: 8, rentRoll: 14288, avgRent: 1429 },
      { agent: "Richard Callow", managed: 6, letOnly: 5, total: 11, rlpLec: 2, rentRoll: 7425, avgRent: 1238 },
      { agent: "Kayleigh Wright", managed: 6, letOnly: 3, total: 9, rlpLec: 4, rentRoll: 6870, avgRent: 1145 },
      { agent: "Stuart Roper", managed: 5, letOnly: 2, total: 7, rlpLec: 2, rentRoll: 9250, avgRent: 1850 },
      { agent: "Graham Cross", managed: 5, letOnly: 0, total: 5, rlpLec: 5, rentRoll: 6112, avgRent: 1222 },
      { agent: "Chris Wilson-Slight", managed: 6, letOnly: 0, total: 6, rlpLec: 6, rentRoll: 6250, avgRent: 1042 },
      { agent: "Lauren Engley", managed: 3, letOnly: 17, total: 20, rlpLec: 0, rentRoll: 2400, avgRent: 800 },
      { agent: "Kirstie Wallington", managed: 2, letOnly: 12, total: 14, rlpLec: 1, rentRoll: 2075, avgRent: 1038 },
      { agent: "Rebecca Adams", managed: 2, letOnly: 2, total: 4, rlpLec: 2, rentRoll: 2650, avgRent: 1325 },
      { agent: "Zilvinas Navickis", managed: 2, letOnly: 0, total: 2, rlpLec: 1, rentRoll: 3200, avgRent: 1600 },
      { agent: "Geraldine Mulhern", managed: 1, letOnly: 2, total: 3, rlpLec: 0, rentRoll: 2150, avgRent: 2150 },
      { agent: "Paul Doig", managed: 1, letOnly: 0, total: 1, rlpLec: 1, rentRoll: 2200, avgRent: 2200 },
      { agent: "Shane Yu", managed: 0, letOnly: 1, total: 1, rlpLec: 0, rentRoll: null, avgRent: null },
      { agent: "TLE Central", managed: 20, letOnly: 0, total: 20, rlpLec: 9, rentRoll: 18335, avgRent: 917 },
    ] satisfies PortfolioRow[],
    totals: { agent: "TOTAL", managed: 362, letOnly: 163, total: 528, rlpLec: 131, rentRoll: 357431, avgRent: null } satisfies PortfolioRow,
    source: "E&W & Glasgow PayProp portfolio report · June 2026 · PayProp API access pending",
  },

  /* ---- Tab 8: Arrears (PayProp arrears report 2026-07-06 — ADMIN ONLY) ---- */
  arrears: {
    summary: {
      totalInArrears: snap(21, undefined, "PayProp arrears report 2026-07-06 — tenants with negative balance"),
      totalValue: snap(19882.04, "£19,882.04", "PayProp arrears report 2026-07-06"),
      eAndWCount: snap(10, undefined, "PayProp arrears report 2026-07-06"),
      eAndWValue: snap(10611.07, "£10,611.07", "PayProp arrears report 2026-07-06"),
      glasgowCount: snap(11, undefined, "PayProp arrears report 2026-07-06"),
      glasgowValue: snap(9270.97, "£9,270.97", "PayProp arrears report 2026-07-06"),
      protectedCount: snap(0, undefined, "PayProp arrears report 2026-07-06 — RLP/LEC · £0.00 claimable · 21 unprotected"),
      protectedClaimable: snap(0, "£0.00", "PayProp arrears report 2026-07-06"),
      pctOfRentRoll: snap(5.6, "5.6%", "£19,882.04 of £357,431 rent roll · 21 active tenants"),
    },
    aging: [
      { label: "< 7 days", count: 9, value: 6326.15 },
      { label: "7 days+", count: 2, value: 5510.0 },
      { label: "14 days+", count: 6, value: 3832.89 },
      { label: "21 days+", count: 4, value: 4213.0 },
      { label: "31 days+", count: 0, value: 0 },
      { label: "No invoice", count: 0, value: 0 },
    ] satisfies ArrearsAgingBucket[],
    agingNote: "Arrears aging — days since last invoice · report date 2026-07-06",
    tenants: [
      { tenant: "Moore, John", property: "Parkend Gardens 8", region: "Glasgow", balance: 3360.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-06-26", lastPayment: "2026-06-29", lastReminder: "2026-06-22" },
      { tenant: "Erica De Araujo Cardoso & Robson Resende Teixeira", property: "Chapter Road, 228a", region: "E&W", balance: 2150.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-06-28", lastPayment: "2026-06-05", lastReminder: "2026-07-06" },
      { tenant: "GREEN GOOSE MANAGEMENT LTD", property: "West Street, Flat 2, 4-6", region: "E&W", balance: 1755.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-06-07", lastPayment: "2026-03-09", lastReminder: null },
      { tenant: "Centennial Property Ltd t/a The Housing Network", property: "Colonsay Close, Flat 3, 7", region: "E&W", balance: 1350.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-07-06", lastPayment: "2026-06-05", lastReminder: "2026-07-06" },
      { tenant: "Susan Downie", property: "Upper Craigour, 11", region: "E&W", balance: 1350.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-06-21", lastPayment: "2025-10-06", lastReminder: "2026-01-05" },
      { tenant: "Z Akbar, S Usman, Z Usman", property: "Albert Road, 17a", region: "E&W", balance: 1253.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-06-14", lastPayment: "2026-06-24", lastReminder: "2026-06-22" },
      { tenant: "David Salisbury", property: "Bowerman Court, 04", region: "E&W", balance: 1200.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-06-30", lastPayment: "2026-06-01", lastReminder: "2026-07-06" },
      { tenant: "Robert Middleton", property: "The Ridgeway, 10", region: "E&W", balance: 1150.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-07-03", lastPayment: "2026-06-03", lastReminder: null },
      { tenant: "Marianne Instanes & Lachlan Barr", property: "Fairholm Street 66", region: "Glasgow", balance: 1075.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-06-22", lastPayment: "2026-06-22", lastReminder: "2026-02-17" },
      { tenant: "Cornish, Michael", property: "Mill Crescent, 24b", region: "Glasgow", balance: 720.97, status: "ACTIVE", protection: "None", lastInvoice: "2026-06-22", lastPayment: "2026-07-03", lastReminder: "2026-02-17" },
      { tenant: "Pierre Noe, Kayla Wilson", property: "Milton Street 2E", region: "Glasgow", balance: 630.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-07-05", lastPayment: "2026-06-18", lastReminder: "2025-10-10" },
      { tenant: "Foley, Kerry", property: "Newlands Drive 105", region: "Glasgow", balance: 625.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-07-06", lastPayment: "2026-06-10", lastReminder: "2026-02-17" },
      { tenant: "Kellsie Cunningham & Blair Guild", property: "Afton Bridgend 100", region: "Glasgow", balance: 620.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-06-11", lastPayment: "2026-06-15", lastReminder: "2026-02-17" },
      { tenant: "Ryan Curran", property: "Park Street 28b, Kilmarnock", region: "Glasgow", balance: 585.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-06-11", lastPayment: "2026-06-26", lastReminder: "2026-06-22" },
      { tenant: "Olalekan Hammed Azeez", property: "Glencairn Avenue 6", region: "Glasgow", balance: 580.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-06-30", lastPayment: "2026-06-04", lastReminder: "2025-05-02" },
      { tenant: "Leigh Johnston & Nicole McCafferty", property: "Fleming Way 91", region: "Glasgow", balance: 515.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-07-04", lastPayment: "2026-07-06", lastReminder: "2026-05-28" },
      { tenant: "Allison, Jamie", property: "Flat 3B, 37 Union Street, Larkhall, ML9 1DZ", region: "Glasgow", balance: 500.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-06-22", lastPayment: "2026-06-02", lastReminder: "2026-05-28" },
      { tenant: "Adrian Bell", property: "Fore Street, Room 3, 66", region: "E&W", balance: 275.15, status: "ACTIVE", protection: "None", lastInvoice: "2026-07-04", lastPayment: "2026-06-15", lastReminder: null },
      { tenant: "Josh Bradbury & Kacey-leigh Howe", property: "Ida Road, Flat 3, 33", region: "E&W", balance: 126.92, status: "ACTIVE", protection: "None", lastInvoice: "2026-06-16", lastPayment: "2026-06-15", lastReminder: null },
      { tenant: "Adesoye, Adebayo Oladimeji", property: "Hillcrest 16", region: "Glasgow", balance: 60.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-06-20", lastPayment: "2026-07-02", lastReminder: "2024-04-22" },
      { tenant: "Roma Cirvinskiene", property: "Lincoln Road, 192, Room 3", region: "E&W", balance: 1.0, status: "ACTIVE", protection: "None", lastInvoice: "2026-07-03", lastPayment: "2026-07-03", lastReminder: null },
    ] satisfies ArrearsTenantRow[],
    footer:
      'Data source: Payprop "Tenants in Arrears" view · 2026-07-06 · 21 total records (10 E&W + 11 Glasgow). Protection status matched against live RLP/LEC policy data from LFL report.',
    // PRIVACY: tenant personal data — arrears view must be admin (Susan) only.
  },

  /* ---- Tab 9: Compliance (REX PM — candidate for live pull later) ---- */
  compliance: {
    totals: {
      totalItems: snap(136, undefined, "Claude Compliance report (REX PM) · report date 7 Jul 2026"),
      overdue: snap(69, undefined, "50.7% of total · Claude Compliance report (REX PM)"),
      upcoming: snap(67, undefined, "49.3% of total · Claude Compliance report (REX PM)"),
    },
    byType: [
      { type: "Gas Safety", total: 38, overdue: 16, upcoming: 22 },
      { type: "EICR", total: 22, overdue: 15, upcoming: 7 },
      { type: "Legionella Assessment", total: 16, overdue: 9, upcoming: 7 },
      { type: "Fire Alarm", total: 16, overdue: 2, upcoming: 14 },
      { type: "EPC", total: 12, overdue: 8, upcoming: 4 },
      { type: "PAT Test", total: 12, overdue: 4, upcoming: 8 },
      { type: "Emergency Lighting", total: 8, overdue: 7, upcoming: 1 },
      { type: "Landlord Registration", total: 6, overdue: 4, upcoming: 2 },
      { type: "Fire Risk Assessment", total: 6, overdue: 4, upcoming: 2 },
    ] satisfies ComplianceTypeRow[],
    byTypeTotal: { type: "Total", total: 136, overdue: 69, upcoming: 67 } satisfies ComplianceTypeRow,
    byAgent: [
      { agent: "Sean McMahon", total: 50, overdue: 24, upcoming: 26, pctOverdue: 48 },
      { agent: "Lianna Denholm", total: 29, overdue: 13, upcoming: 16, pctOverdue: 45 },
      { agent: "Rhiannon Dodge", total: 19, overdue: 3, upcoming: 16, pctOverdue: 16 },
      { agent: "Joe Patten", total: 13, overdue: 11, upcoming: 2, pctOverdue: 85 },
      { agent: "Lauren Engley", total: 4, overdue: 4, upcoming: 0, pctOverdue: 100 },
      { agent: "Richard Callow", total: 4, overdue: 3, upcoming: 1, pctOverdue: 75 },
      { agent: "Tony Poon", total: 4, overdue: 2, upcoming: 2, pctOverdue: 50 },
      { agent: "Chris Wilson-Slight", total: 3, overdue: 2, upcoming: 1, pctOverdue: 67 },
      { agent: "Dan Richards", total: 3, overdue: 1, upcoming: 2, pctOverdue: 33 },
      { agent: "Bernadine Williams", total: 2, overdue: 1, upcoming: 1, pctOverdue: 50 },
      { agent: "Stuart Roper", total: 2, overdue: 2, upcoming: 0, pctOverdue: 100 },
      { agent: "Claire Riley", total: 1, overdue: 1, upcoming: 0, pctOverdue: 100 },
      { agent: "Graham Cross", total: 1, overdue: 1, upcoming: 0, pctOverdue: 100 },
      { agent: "Kirstie Wallington", total: 1, overdue: 1, upcoming: 0, pctOverdue: 100 },
    ] satisfies ComplianceAgentRow[],
    byAgentTotal: { agent: "Total", total: 136, overdue: 69, upcoming: 67, pctOverdue: 51 } satisfies ComplianceAgentRow,
    // Sample of the 136 item rows shown on the source dashboard (earliest/most overdue first)
    sampleItems: [
      { task: "EPC 9 Plested Court", type: "EPC", manager: "Bernadine Williams", status: "Not Started", expires: "2025-12-22", dueIn: "OVERDUE" },
      { task: "PAT Test 11 Upper Craigour, Moredun", type: "PAT Test", manager: "Sean McMahon", status: "Not Started", expires: "2026-02-17", dueIn: "OVERDUE" },
      { task: "EICR 19 Canongate", type: "EICR", manager: "Sean McMahon", status: "In Progress", expires: "2026-03-09", dueIn: "OVERDUE" },
      { task: "Gas Safety Waverley Park 11, Bonnyrigg", type: "Gas Safety", manager: "Lianna Denholm", status: "Not Started", expires: "2026-04-01", dueIn: "OVERDUE" },
      { task: "EPC Flat 5, 33 Ida Road, Skegness", type: "EPC", manager: "Joe Patten", status: "Not Started", expires: "2026-05-12", dueIn: "OVERDUE" },
      { task: "Gas Safety 16 Lord Street, Coventry", type: "Gas Safety", manager: "Claire Riley", status: "Not Started", expires: "2026-06-22", dueIn: "OVERDUE" },
      { task: "EICR Apartment 20, Clarendon House", type: "EICR", manager: "Chris Wilson-Slight", status: "Not Started", expires: "2026-06-23", dueIn: "OVERDUE" },
      { task: "EPC Apartment 20, Clarendon House", type: "EPC", manager: "Chris Wilson-Slight", status: "Not Started", expires: "2026-07-13", dueIn: "1d" },
      { task: "Gas Safety 7 Oliver Road, Hampton Vale, Peterborough", type: "Gas Safety", manager: "Joe Patten", status: "Not Started", expires: "2026-07-14", dueIn: "2d" },
      { task: "Gas Safety 13 Dodman Green", type: "Gas Safety", manager: "Tony Poon", status: "Not Started", expires: "2026-07-15", dueIn: "3d" },
      { task: "EPC 114 Stewarton Street", type: "EPC", manager: "Sean McMahon", status: "Not Started", expires: "2026-07-19", dueIn: "7d" },
      { task: "EPC Flat 3, 7 Colonsay Close", type: "EPC", manager: "Sean McMahon", status: "Not Started", expires: "2026-08-04", dueIn: "23d" },
    ] satisfies ComplianceItemRow[],
    reportDate: "7 Jul 2026",
    source: "Claude Compliance report (REX PM) — candidate for live pull via REX Property Management module",
  },

  /* ---- Which system feeds each section ---- */
  sources: {
    headline: "REX KPI reports · Lettings Support - Move In Report · PayProp fee reports",
    headcount: "Agent Headcount report",
    businessFunnel: "REX KPI reports · Lettings Support - Move In Report",
    conversions: "Derived from sales funnel · Finance reports for GCI",
    masByPartnerType: "REX export · Agent Headcount export",
    yoyGrowth: "REX KPI reports · Agent Headcount report · PayProp portfolio reports",
    paidLeads: "Go High Level (no API access yet)",
    moveIns: "Lettings Support - Move In Report",
    income: "E&W & Glasgow PayProp reports & Budget reports 24-26 (PayProp access pending)",
    businessValue: "E&W & Glasgow PayProp portfolio reports & Finance monthly summary fee report & Budget report",
    h2Reforecast: "H2 2026 Reforecast (19th Nov 25 draft) — Base44 P&L tab is password-protected, source P&L pending",
    agentKpis: "Agent Headcount report & REX KPI reports & Finance monthly summary fee report",
    partnerNetIncome: "Monthly fee report (net commission paid to partners, exc VAT)",
    portfolio: "E&W & Glasgow PayProp portfolio report (no API access yet)",
    arrears: "PayProp arrears report 2026-07-06 (no API access yet · admin-only, tenant personal data)",
    compliance: "Claude Compliance report (REX PM)",
  } as Record<string, string>,
};

/* SOURCES status map moved to lib/roster.ts (client-safe) — re-exported above. */

/**
 * Structural type of the full seed — used via TYPE-ONLY imports (erased at
 * compile time, so safe alongside "server-only") by the admin client tabs,
 * which receive the seed data itself through the gated /api/admin/seed route.
 */
export type SeedData = typeof SEED;

/* ============================== helpers ============================== */

const NULL_NOTE = SNAPSHOT_NOTE;

function nullStat(): StatValue {
  return { value: null, source: "snapshot", note: NULL_NOTE, asOf: SNAPSHOT_DATE };
}

function statFrom(value: number | null, src: string): StatValue {
  return value === null ? nullStat() : snap(value, undefined, src);
}

/**
 * Per-agent funnel stats for July MTD, from the Agent Detail KPI table.
 * Agents not in the table (e.g. Tony Poon in July) get all-null StatValues.
 */
export function agentSeedStats(agentKey: string): FunnelStats {
  const row = SEED.agentKpisJulyMtd.rows.find((r) => nameMatchesAgent(r.agent, agentKey));
  const src = "REX KPI reports · Agent Detail tab · Jul MTD";
  if (!row) {
    return {
      marketAppraisals: nullStat(),
      listings: nullStat(),
      viewings: nullStat(),
      applications: nullStat(),
      moveIns: nullStat(),
      pipeline: nullStat(),
      gci: nullStat(),
    };
  }
  return {
    marketAppraisals: statFrom(row.ma, src),
    listings: statFrom(row.li, src),
    viewings: statFrom(row.vw, src),
    applications: statFrom(row.ap, src),
    moveIns: statFrom(row.mi, src),
    pipeline: statFrom(row.pn, src),
    gci: statFrom(row.gci, src),
  };
}

/** July move-ins for one agent (rows verbatim from the Move-ins Jul table). */
export function agentMoveIns(agentKey: string): MoveInRow[] {
  return SEED.moveInsJuly.rows.filter((r) => nameMatchesAgent(r.agent, agentKey));
}

/**
 * Pipeline rows for one agent — July pipeline + Aug–Sep forward pipeline
 * combined; each row carries `period: "july" | "aug-sep"`.
 * NOTE: unqualified "Sean McMahon" pipeline rows match BOTH Sean keys — the
 * source dashboard does not split them between Edinburgh and Glasgow.
 */
export function agentPipeline(agentKey: string): PipelineRow[] {
  return [...SEED.julyPipeline, ...SEED.forwardPipeline].filter((r) =>
    nameMatchesAgent(r.agent, agentKey),
  );
}

/** Jan–Jun + YTD net income row for one agent, or null if not in the table. */
export function agentNetIncomeYtd(agentKey: string): PartnerNetIncomeRow | null {
  return SEED.partnerNetIncome.rows.find((r) => nameMatchesAgent(r.agent, agentKey)) ?? null;
}

/**
 * Compliance counts row for one agent, or null.
 * NOTE: the source table has a single unqualified "Sean McMahon" row — it is
 * returned for BOTH sean-mcmahon-edinburgh and sean-mcmahon-glasgow.
 */
export function agentCompliance(agentKey: string): ComplianceAgentRow | null {
  return SEED.compliance.byAgent.find((r) => nameMatchesAgent(r.agent, agentKey)) ?? null;
}

/** Portfolio-by-partner row for one agent, or null. */
export function agentPortfolio(agentKey: string): PortfolioRow | null {
  return SEED.portfolio.byPartner.find((r) => nameMatchesAgent(r.agent, agentKey)) ?? null;
}
