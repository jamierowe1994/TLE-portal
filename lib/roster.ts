// Client-safe roster + source-status constants. Split out of lib/seed-data.ts
// so client components can use the agent roster and name-matching helpers
// WITHOUT pulling the (server-only) business/tenant seed data into the bundle.
// Contains no tenant personal data and no owner-only financials.

import { currentMonth } from "@/lib/format";
import type { RosterEntry, SourceInfo, SourceKey } from "@/lib/seed-types";

export const SNAPSHOT_DATE = "2026-07-11";
export const SNAPSHOT_NOTE =
  "Figure from Susan's TLE Business Dashboard — we couldn't match a live stat for this yet";

/* ============================ THE LIVE MONTH ============================ */

/**
 * The first month the portal reports its OWN figures for.
 *
 * Everything before this is Susan's hand-keyed spreadsheet, captured once as
 * the July snapshot. Everything from here on is pulled live from REX and
 * PayProp on demand. The two are not the same measurement and must never be
 * added together or drawn on one line — a trend that is half typed and half
 * measured tells you about the change of method, not the business.
 *
 * There is deliberately NO backfill of Jan–Jul. Year-to-date therefore starts
 * here, and every screen that shows it says "since August 2026" out loud so a
 * partial year can't be read as a full one.
 */
export const LIVE_START = "2026-08";

/**
 * The earliest month the business can be reported on at all — a hard floor.
 *
 * Rex answers listings and appraisals back into early 2025, but the TLE viewing
 * appointment types (953/956) only came into use in AUGUST 2025. Before that a
 * viewings query succeeds and returns nothing, and the counts helper returns
 * null only when a call FAILS — never when Rex legitimately holds nothing. So
 * a pre-August-2025 month would print "0 viewings" as a trading fact.
 * August 2025 is itself a part-month (21 viewings vs 60 in September), so the
 * floor is September. Measured 10 Aug 2026.
 */
export const HISTORY_FLOOR = "2025-09";

/** Clamp a requested month up to the floor. */
export function withinHistory(month: string): string {
  return month < HISTORY_FLOOR ? HISTORY_FLOOR : month;
}

/**
 * The month the portal is standing in — the ONE month a current-state figure
 * (on the market now, in progression now, the portfolio) may answer for.
 *
 * Read from the clock, floored at LIVE_START. This replaces four hand-typed
 * copies of "2026-07" that had to agree and, once August began, didn't: the
 * period picker rolled forward with the calendar while the dashboard and the
 * stats API stayed pinned to July, so August was classed as "the future" and
 * every tile either emptied out or — worse — kept showing July's numbers under
 * an August heading. Anything that needs the live month imports this.
 */
export function liveMonth(): string {
  const now = currentMonth();
  return now < LIVE_START ? LIVE_START : now;
}

/** Is this month one the portal reports live figures for at all? */
export function isLiveEra(month: string): boolean {
  return month >= LIVE_START;
}

/** Months of the live era within a requested set, oldest first. */
export function liveEraMonths(months: string[]): string[] {
  return months.filter(isLiveEra);
}

/* ============================== ROSTER ============================== */

export const ROSTER: RosterEntry[] = [
  // Active partners (appear in July 2026 tables)
  { agentKey: "rhiannon-dodge", displayName: "Rhiannon Dodge", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "sean-mcmahon-edinburgh", displayName: "Sean McMahon (Edinburgh)", region: "Edinburgh", partnerType: "TLE", active: true },
  { agentKey: "sean-mcmahon-glasgow", displayName: "Sean Mc Mahon (Glasgow)", region: "Glasgow", partnerType: "TLE", active: true },
  { agentKey: "lauren-engley", displayName: "Lauren Engley", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "bernadine-williams", displayName: "Bernadine Williams", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "joe-patten", displayName: "Joe Patten", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "stuart-roper", displayName: "Stuart Roper", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "shane-yu", displayName: "Shane Yu", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "kirstie-wallington", displayName: "Kirstie Wallington", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "lianna-denholm", displayName: "Lianna Denholm", region: "Edinburgh", partnerType: "TLE", active: true },
  { agentKey: "graham-cross", displayName: "Graham Cross", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "rebecca-adams", displayName: "Rebecca Adams", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "james-crumpton", displayName: "James Crumpton", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "tony-poon", displayName: "Tony Poon", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "dan-richards", displayName: "Dan Richards", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "claire-riley", displayName: "Claire Riley", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "kayleigh-wright", displayName: "Kayleigh Wright", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "chris-wilson-slight", displayName: "Chris Wilson-Slight", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "geraldine-mulhern", displayName: "Geraldine Mulhern", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "richard-callow", displayName: "Richard Callow", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "paul-doig", displayName: "Paul Doig", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "zilvinas-navickis", displayName: "Zilvinas Navickis", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "tle-central", displayName: "TLE Central", region: "E&W", partnerType: "TLE", active: true }, // house account
  // Joined June 2026 (paid joining fees in June)
  { agentKey: "simon-fan", displayName: "Simon Fan", region: "E&W", partnerType: "TLE", active: true },
  { agentKey: "rovena-buci", displayName: "Rovena Buci", region: "E&W", partnerType: "TLE", active: true },
  // Starting Aug 2026 (signed, building pipeline)
  { agentKey: "chanade-patrick", displayName: "Chanade Patrick", region: "E&W", partnerType: "TLE", active: false },
  // Left the business
  { agentKey: "david-quigg", displayName: "David Quigg", region: "E&W", partnerType: "TLE", active: false },
  { agentKey: "brian-hankins-lewis", displayName: "Brian Hankins-Lewis", region: "E&W", partnerType: "TLE", active: false },
  { agentKey: "margo-wilson", displayName: "Margo Wilson", region: "Glasgow", partnerType: "TLE", active: false }, // Glasgow Jan–Apr
];

/* ------------------------- name → agentKey matching ------------------------- */
// Tables spell agents inconsistently ("Sean McMahon", "Sean Mc Mahon (Glasgow)",
// "Sean McMahon (Edinburgh)"). Normalise by stripping spaces/hyphens/dots and
// pulling out any "(qualifier)". An UNQUALIFIED "Sean McMahon" (as in the
// pipeline + compliance tables) matches BOTH Sean keys — the source dashboard
// does not split those rows between Edinburgh and Glasgow.

function splitName(raw: string): { base: string; qualifier: string | null } {
  const m = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const core = m ? m[1] : raw;
  const qualifier = m ? m[2].toLowerCase().replace(/[^a-z0-9]/g, "") : null;
  const base = core.toLowerCase().replace(/[^a-z0-9]/g, "");
  return { base, qualifier };
}

const BASE_NAME_TO_KEYS: Record<string, string[]> = {};
for (const entry of ROSTER) {
  const { base } = splitName(entry.displayName);
  (BASE_NAME_TO_KEYS[base] ??= []).push(entry.agentKey);
}

/** All agentKeys a verbatim table name could refer to. */
export function agentKeysForName(name: string): string[] {
  const { base, qualifier } = splitName(name);
  const keys = BASE_NAME_TO_KEYS[base] ?? [];
  if (qualifier && keys.length > 1) {
    const filtered = keys.filter((k) => k.includes(qualifier));
    return filtered.length > 0 ? filtered : keys;
  }
  return keys;
}

/** Does a verbatim table name refer to this agentKey (handles spelling variants)? */
export function nameMatchesAgent(name: string, agentKey: string): boolean {
  return agentKeysForName(name).includes(agentKey);
}

/* ============================== SOURCES status map ============================== */

export const SOURCES: Record<SourceKey, SourceInfo> = {
  rex: {
    status: "attempting-live",
    label: "REX CRM",
    note: "Feeds KPI funnel, agent KPIs and compliance (REX PM). Live integration being attempted — snapshot fallback until endpoints confirmed.",
  },
  payprop: {
    status: "live",
    label: "PayProp",
    note: "Live via the PayProp API (OAuth) — GCI and income actuals, the managed portfolio, rent roll and arrears.",
  },
  ghl: {
    status: "attempting-live",
    label: "Go High Level",
    note: "Feeds paid leads and lead→MA funnel. Live pull built (v2 private-integration token) — snapshot fallback until the Paid Leads pipelines answer.",
  },
  meta: {
    status: "live",
    label: "Meta Ads",
    note: "Live via Graph API (spend, leads, CPL per agent campaign).",
  },
};
