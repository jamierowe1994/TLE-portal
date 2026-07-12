import "server-only";

// Client for the sister "Ads app" (TEG PAID ADS) partner API. Server-to-server
// only: the shared key (ADS_API_KEY) never reaches the browser. Auto-match by
// email — we ask the Ads app for a given agent's live ad stats.

export interface AdsAdRow {
  id: string;
  name: string;
  status: string;
  imageUrl: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  cpl: number | null;
}

export interface AdsAppResult {
  found: boolean;
  configured: boolean;
  preset?: string;
  snapshot?: {
    impressions: number;
    clicks: number;
    spend: number;
    leads: number;
    cpl: number | null;
    datePreset: string;
  };
  creatives?: Array<{ adName: string; imageUrl: string }>;
  ads?: AdsAdRow[];
  error?: string;
}

function base(): string | null {
  const b = process.env.ADS_API_BASE;
  return b ? b.replace(/\/$/, "") : null;
}

/** The owner has wired the Ads-app link (base URL + shared key). */
export function adsApiConfigured(): boolean {
  return !!(base() && process.env.ADS_API_KEY);
}

/** Ask the Ads app for one agent's live ad stats by email. null on any failure
 * (so callers degrade gracefully — never throws, never hangs a page). */
export async function fetchAgentAds(
  email: string,
  preset?: string | null
): Promise<AdsAppResult | null> {
  if (!adsApiConfigured() || !email) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const url =
      `${base()}/api/partner/ads?email=${encodeURIComponent(email)}` +
      (preset ? `&preset=${encodeURIComponent(preset)}` : "");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.ADS_API_KEY}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as AdsAppResult;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
