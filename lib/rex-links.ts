// Deep links into the REX web app — client-safe, no secrets.
//
// URL shape confirmed against live records (29 Jul 2026):
//   https://app.rexsoftware.com/listings/#lens=sale&id=80821
//   https://app.rexsoftware.com/listings/#lens=leased&id=263275
// The lens must match the listing's state or REX opens the wrong tab:
// current lettings stock is "rental", the managed book is "leased".
export type RexLens = "rental" | "leased" | "sale";

const REX_APP_URL = "https://app.rexsoftware.com";

export function rexListingUrl(listingId: string, lens: RexLens): string {
  return `${REX_APP_URL}/listings/#lens=${lens}&id=${encodeURIComponent(listingId)}`;
}
