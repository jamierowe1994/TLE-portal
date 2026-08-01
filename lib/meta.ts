import "server-only";
import crypto from "crypto";
import type { UserProfile } from "./types";

// Meta Marketing API client for The Lettings Expert — ported from the TEG
// PAID ADS repo's lib/meta.ts, trimmed to a single brand (lettings).
//
// One shared System User token (TLE lives in the same Business Manager as the
// other Experts Group brands); env vars keep TEG's exact names so James can
// copy values straight from the TEG Railway project:
//   META_SYSTEM_TOKEN         — never-expiring System User token
//   META_APP_SECRET           — signs every call (appsecret_proof)
//   META_AD_ACCOUNT_LETTINGS  — TLE ad account id (act_… or bare number)
//   META_PAGE_LETTINGS        — TLE Facebook Page id (leadgen retrieval later)
//
// Per-agent mapping: the admin pastes Meta campaign id(s) onto the agent's
// portal profile (user.metaCampaignId, comma-separated). No naming
// conventions anywhere — mapping is explicit.

const GRAPH = "https://graph.facebook.com/v21.0";
const CALL_TIMEOUT_MS = 8_000; // a slow Meta call must never hang a page

function token(): string {
  return process.env.META_SYSTEM_TOKEN ?? "";
}

export function metaTokenSet(): boolean {
  return !!token();
}

function normaliseAct(raw: string | undefined | null): string | null {
  if (!raw) return null;
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

function accountId(): string | null {
  return normaliseAct(process.env.META_AD_ACCOUNT_LETTINGS);
}

function pageId(): string | null {
  return process.env.META_PAGE_LETTINGS || null;
}

// Presence booleans for the admin diagnostics panel — NEVER the values.
export function metaConfigPresence(): {
  token: boolean;
  appSecret: boolean;
  adAccount: boolean;
  page: boolean;
} {
  return {
    token: !!process.env.META_SYSTEM_TOKEN,
    appSecret: !!process.env.META_APP_SECRET,
    adAccount: !!process.env.META_AD_ACCOUNT_LETTINGS,
    page: !!process.env.META_PAGE_LETTINGS,
  };
}

// Meta recommends signing server calls with appsecret_proof — it MUST be
// computed with the SAME token the call uses.
function appSecretProof(tok: string): string | undefined {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return undefined;
  return crypto.createHmac("sha256", secret).update(tok).digest("hex");
}

async function graph(
  path: string,
  params: Record<string, string>,
  tokenOverride?: string
): Promise<Record<string, unknown>> {
  const tok = tokenOverride ?? token();
  const q = new URLSearchParams({ access_token: tok, ...params });
  const proof = appSecretProof(tok);
  if (proof) q.set("appsecret_proof", proof);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${GRAPH}/${path}?${q.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = data?.error as { message?: string } | undefined;
    throw new Error(err?.message ?? `Meta API error ${res.status}`);
  }
  return data;
}

// Meta reports several OVERLAPPING lead action types for the same leads.
// Summing them multi-counts every lead (~5–6× too high in TEG's experience).
// Count ONLY the first match in priority order — `lead` is what Ads Manager's
// Leads column shows.
const LEAD_ACTION_PRIORITY = [
  "lead",
  "onsite_conversion.lead_grouped",
  "leadgen.other",
  "offsite_conversion.fb_pixel_lead",
];

function countLeads(
  actions: Array<{ action_type: string; value: string }>
): number {
  for (const type of LEAD_ACTION_PRIORITY) {
    const hit = actions.find((a) => a.action_type === type);
    if (hit) return Number(hit.value ?? 0);
  }
  return 0;
}

// Split a comma-separated campaign-ids string (how it's stored on the agent
// profile — agents can run several campaigns at once) into clean ids.
export function parseCampaignIds(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// People paste whatever ID Ads Manager happens to show — often an AD SET or
// AD id rather than the campaign's, and possibly in a DIFFERENT ad account
// than the configured one. Those read back fine by id, but filtering insights
// by campaign.id then matches nothing → silent zeros. Resolve every tagged id
// to its real parent campaign + owning account.
const idResolveCache = new Map<
  string,
  { campaignId: string; account: string | null }
>();

async function resolveTaggedId(
  id: string
): Promise<{ campaignId: string; account: string | null }> {
  const cached = idResolveCache.get(id);
  if (cached) return cached;
  let campaignId = id;
  let account: string | null = null;
  try {
    // campaign_id only exists on ad sets and ads — asking a campaign for it
    // errors, which is exactly how we tell them apart…
    const o = (await graph(id, { fields: "account_id,campaign_id" })) as {
      account_id?: string;
      campaign_id?: string;
    };
    if (o.campaign_id) campaignId = o.campaign_id;
    account = normaliseAct(o.account_id);
  } catch {
    try {
      // …so fall back to reading it as the campaign it (hopefully) is.
      const c = (await graph(id, { fields: "account_id" })) as {
        account_id?: string;
      };
      account = normaliseAct(c.account_id);
    } catch {
      /* unreadable id — account stays null, configured-account fallback below */
    }
  }
  const resolved = { campaignId, account };
  idResolveCache.set(id, resolved);
  return resolved;
}

// Group the (resolved) campaign ids by the ad account each one lives in, so
// every query below asks the right account. Unresolvable ids fall back to the
// configured TLE account.
async function groupCampaignsByAccount(
  campaignIds: string[]
): Promise<Map<string, string[]>> {
  const fallback = accountId();
  const groups = new Map<string, string[]>();
  await Promise.all(
    campaignIds.map(async (id) => {
      const { campaignId, account } = await resolveTaggedId(id);
      const key = account ?? fallback;
      if (!key) return;
      const list = groups.get(key) ?? [];
      if (!list.includes(campaignId)) groups.set(key, [...list, campaignId]);
    })
  );
  return groups;
}

// Verify campaign ids against Meta — returns each one's real name + status so
// the admin can SEE the link is right when they hit Save (a bad id comes back
// as its error message instead). Shows the PARENT campaign's name when an
// ad set / ad id was pasted.
export async function getCampaignsInfo(
  ids: string[]
): Promise<Array<{ id: string; name?: string; status?: string; error?: string }>> {
  return Promise.all(
    ids.map(async (id) => {
      try {
        const { campaignId } = await resolveTaggedId(id);
        const c = (await graph(campaignId, {
          fields: "name,effective_status",
        })) as { name?: string; effective_status?: string };
        return { id, name: c.name, status: c.effective_status };
      } catch (e) {
        return { id, error: e instanceof Error ? e.message : "Meta error" };
      }
    })
  );
}

// Date ranges offered in the UI. Meta's presets exclude "today", matching
// Ads Manager's own windows.
export const META_DATE_PRESETS = [
  { id: "last_7d", label: "7 days" },
  { id: "last_14d", label: "14 days" },
  { id: "last_30d", label: "30 days" },
  { id: "last_90d", label: "90 days" },
] as const;

const VALID_PRESETS = new Set<string>(META_DATE_PRESETS.map((p) => p.id));

export function sanitizePreset(p: string | null | undefined): string {
  return p && VALID_PRESETS.has(p) ? p : "last_30d";
}

interface CampaignSnapshot {
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  cpl: number | null;
  datePreset: string;
}

// Per-AGENT stats: insights for just their campaign(s), level=campaign,
// each queried in the ad account it actually lives in. One unreachable
// account doesn't zero out the rest (per-account try/catch, skip).
async function getCampaignSnapshot(
  campaignIds: string[],
  datePreset: string
): Promise<CampaignSnapshot | null> {
  if (campaignIds.length === 0) return null;
  const groups = await groupCampaignsByAccount(campaignIds);
  if (groups.size === 0) return null;

  let impressions = 0;
  let clicks = 0;
  let spend = 0;
  let leads = 0;
  await Promise.all(
    [...groups.entries()].map(async ([acc, ids]) => {
      try {
        const insights = (await graph(`${acc}/insights`, {
          level: "campaign",
          fields: "impressions,clicks,spend,actions",
          date_preset: datePreset,
          filtering: JSON.stringify([
            { field: "campaign.id", operator: "IN", value: ids },
          ]),
          limit: "100",
        })) as { data?: Array<Record<string, unknown>> };
        for (const row of insights.data ?? []) {
          impressions += Number(row.impressions ?? 0);
          clicks += Number(row.clicks ?? 0);
          spend += Number(row.spend ?? 0);
          leads += countLeads(
            (row.actions as Array<{ action_type: string; value: string }>) ?? []
          );
        }
      } catch {
        /* skip this account's contribution rather than failing the lot */
      }
    })
  );
  return {
    impressions,
    clicks,
    spend,
    leads,
    cpl: leads > 0 ? spend / leads : null,
    datePreset,
  };
}

interface RawAd {
  id: string;
  name: string;
  status: string;
  imageUrl: string | null;
}

// Every ad inside the agent's tagged campaign(s), with each creative's
// thumbnail. Queries each campaign's OWN ad account. Best-effort: returns []
// rather than throwing; a missing thumbnail just leaves imageUrl null.
// Active ads first, capped at 12.
async function getAdsWithCreatives(campaignIds: string[]): Promise<RawAd[]> {
  try {
    if (campaignIds.length === 0) return [];
    const groups = await groupCampaignsByAccount(campaignIds);
    if (groups.size === 0) return [];

    const perAccount = await Promise.all(
      [...groups.entries()].map(async ([acc, ids]) => {
        try {
          const ads = (await graph(`${acc}/ads`, {
            fields: "name,effective_status,creative{id}",
            filtering: JSON.stringify([
              { field: "campaign.id", operator: "IN", value: ids },
            ]),
            limit: "25",
          })) as {
            data?: Array<{
              id?: string;
              name?: string;
              effective_status?: string;
              creative?: { id?: string };
            }>;
          };
          return ads.data ?? [];
        } catch {
          return [];
        }
      })
    );

    const list = perAccount
      .flat()
      .filter((a) => a.id)
      .sort((a, b) =>
        a.effective_status === "ACTIVE" && b.effective_status !== "ACTIVE"
          ? -1
          : b.effective_status === "ACTIVE" && a.effective_status !== "ACTIVE"
            ? 1
            : 0
      )
      .slice(0, 12);

    return Promise.all(
      list.map(async (ad) => {
        let imageUrl: string | null = null;
        if (ad.creative?.id) {
          try {
            const creative = (await graph(ad.creative.id, {
              fields: "thumbnail_url",
              thumbnail_width: "800",
              thumbnail_height: "800",
            })) as { thumbnail_url?: string };
            imageUrl = creative.thumbnail_url ?? null;
          } catch {
            /* thumbnail is optional */
          }
        }
        return {
          id: String(ad.id),
          name: ad.name ?? "Untitled ad",
          status: ad.effective_status ?? "UNKNOWN",
          imageUrl,
        };
      })
    );
  } catch {
    return [];
  }
}

// ── Public per-agent API (what the routes call) ─────────────────────────────

export interface AgentMetaStats {
  configured: boolean;
  snapshot?: {
    impressions: number;
    clicks: number;
    spend: number;
    leads: number;
    cpl: number | null;
    datePreset: string;
  };
  // Ads that have an image — feeds a rotating "Current ad" tile.
  creatives?: Array<{ adName: string; imageUrl: string }>;
  error?: string;
}

// The signed-in agent's OWN live ad stats. { configured: false } until both
// the token and their campaign tag(s) exist, so the dashboard can show
// placeholders honestly. Defensive: Meta failures come back as an `error`
// string, never a throw.
export async function getAgentMetaStats(
  user: Pick<UserProfile, "metaCampaignId">,
  preset?: string | null
): Promise<AgentMetaStats> {
  const campaignIds = parseCampaignIds(user.metaCampaignId);
  if (!metaTokenSet() || campaignIds.length === 0) {
    return { configured: false };
  }
  const datePreset = sanitizePreset(preset);
  try {
    const [snapshot, ads] = await Promise.all([
      getCampaignSnapshot(campaignIds, datePreset),
      getAdsWithCreatives(campaignIds),
    ]);
    if (!snapshot) return { configured: false };
    const creatives = ads
      .filter((a) => a.imageUrl)
      .map((a) => ({ adName: a.name, imageUrl: a.imageUrl as string }));
    return { configured: true, snapshot, creatives };
  } catch (e) {
    return {
      configured: true,
      error: e instanceof Error ? e.message : "Meta request failed",
    };
  }
}

// Lightweight connection check (admin diagnostics) — just proves the token +
// ad account work, plus the account name. Never throws.
export async function metaPing(): Promise<{
  configured: boolean;
  ok: boolean;
  account?: string;
  error?: string;
}> {
  const acc = accountId();
  if (!metaTokenSet() || !acc) return { configured: false, ok: false };
  try {
    const info = (await graph(acc, { fields: "name" })) as { name?: string };
    return { configured: true, ok: true, account: info.name };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      error: e instanceof Error ? e.message : "Meta request failed",
    };
  }
}

// Kept for future leadgen retrieval (needs META_PAGE_LETTINGS + the Page
// asset with `leads_retrieval` on the System User). Exported so the admin
// panel can show whether the Page is wired.
export function metaPageConfigured(): boolean {
  return !!pageId();
}

/* ----------------------- business-wide leads (MTD) ----------------------- */

export interface BusinessLeadsMTD {
  leads: number;
  spend: number;
  cpl: number | null;
  /** "account" = the TLE ad account's own insights; "campaigns" = summed
   *  across every agent's tagged campaigns (fallback when no account id). */
  source: "account" | "campaigns";
}

/**
 * Leads generated this month across the whole TLE paid operation — the one
 * Paid Leads figure Meta can answer directly (referrals/MAs live in
 * GoHighLevel until the TEG system lands). Uses the lettings ad account when
 * configured, else sums the agents' tagged campaigns. null → keep snapshot.
 */
export async function getBusinessLeadsMTD(
  fallbackCampaignIds: string[]
): Promise<BusinessLeadsMTD | null> {
  if (!metaTokenSet()) return null;

  const acc = accountId();
  if (acc) {
    try {
      const insights = (await graph(`${acc}/insights`, {
        level: "account",
        fields: "spend,actions",
        date_preset: "this_month",
      })) as { data?: Array<Record<string, unknown>> };
      let leads = 0;
      let spend = 0;
      for (const row of insights.data ?? []) {
        spend += Number(row.spend ?? 0);
        leads += countLeads(
          (row.actions as Array<{ action_type: string; value: string }>) ?? []
        );
      }
      return { leads, spend, cpl: leads > 0 ? spend / leads : null, source: "account" };
    } catch {
      /* fall through to the campaign sum */
    }
  }

  if (fallbackCampaignIds.length === 0) return null;
  const snap = await getCampaignSnapshot(fallbackCampaignIds, "this_month").catch(
    () => null
  );
  if (!snap) return null;
  return { leads: snap.leads, spend: snap.spend, cpl: snap.cpl, source: "campaigns" };
}
