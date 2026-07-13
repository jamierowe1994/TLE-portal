import "server-only";

// Client for the sister "Ads app" (TEG PAID ADS) partner API — organic socials.
// Server-to-server only: the shared key (ADS_API_KEY) never reaches the browser.
// The TLE portal is single-brand, so we always ask for "lettings".

export interface SocialPlatform {
  configured: boolean;
  followers: number | null;
  gained: number | null;
  handle: string | null;
  error?: string;
}

export interface SocialSnapshot {
  facebook: SocialPlatform;
  instagram: SocialPlatform;
}

function base(): string | null {
  const b = process.env.ADS_API_BASE;
  return b ? b.replace(/\/$/, "") : null;
}

/** The owner has wired the Ads-app link (base URL + shared key). */
export function socialApiConfigured(): boolean {
  return !!(base() && process.env.ADS_API_KEY);
}

/** Ask the Ads app for the brand's live socials snapshot. null on any failure
 * (so the caller degrades gracefully — never throws, never hangs a page). */
export async function fetchBrandSocial(
  preset?: string | null,
  brand = "lettings"
): Promise<SocialSnapshot | null> {
  if (!socialApiConfigured()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const url =
      `${base()}/api/partner/social?brand=${encodeURIComponent(brand)}` +
      (preset ? `&preset=${encodeURIComponent(preset)}` : "");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.ADS_API_KEY}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { social?: SocialSnapshot };
    return data.social ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
