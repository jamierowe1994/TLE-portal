// Brand constants + email gating for The Lettings Expert.
// Client-safe (no server-only imports) — isAdminEmail simply returns false in
// the browser where ADMIN_EMAILS is not exposed; the server derives isAdmin.

export const BRAND = {
  name: "The Lettings Expert",
  shortName: "TLE",
  accent: "#E31F36",
  accentDark: "#C11A2E",
  accentSoft: "#FEF2F2",
  logo: "/brand-logos/TLE - Icon.png",
  logoColour: "/brand-logos/TLE - Colour.png",
  logoWhite: "/brand-logos/TLE - White.png",
  // NOTE: domain is "thelettingexperts" — singular "letting" (per TEG registry).
  domains: ["thelettingexperts.co.uk", "lettingexperts.co.uk"],
  headOfficeDomains: ["theexpertsgroup.co.uk"],
} as const;

export function allowedEmailDomains(): string[] {
  return [...BRAND.domains, ...BRAND.headOfficeDomains];
}

/** Signup/login domain gate: TLE domains + head office only. */
export function isAllowedEmailDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return false;
  return allowedEmailDomains().includes(domain);
}

/**
 * Admin gate — ADMIN_EMAILS env var, comma-separated, case-insensitive.
 * e.g. ADMIN_EMAILS=susan@thelettingexperts.co.uk,james@therecruitmentexperts.co.uk
 * Unset → nobody is admin (no baked-in defaults).
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.ADMIN_EMAILS ?? "";
  const admins = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.trim().toLowerCase());
}
