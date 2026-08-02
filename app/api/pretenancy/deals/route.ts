import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { isPreTenancyEmail } from "@/lib/brand";
import { findById } from "@/lib/users-store";
import { getAllPropolyDeals, getPropolyMoveInForecast } from "@/lib/propoly-deals";
import {
  getBusinessPhotoIndex,
  matchListingConfident,
  matchListingPhoto,
} from "@/lib/rex-stats";
import { effectivePortalStage, getOverlays } from "@/lib/deal-store";
import { getPortfolioBook, propertyKey } from "@/lib/payprop-portfolio";
import { getTenancyRegister } from "@/lib/payprop-tenancy";
import { getTobRegister, type TobStatus } from "@/lib/rex-esign";
import { PORTAL_STAGES, portalStageOf } from "@/lib/propoly-stages";
import type { DealPortalOverlay } from "@/lib/types";

// GET /api/pretenancy/deals — every Propoly deal across all TLE agents with
// the portal overlay (notes, stage moves, checklist) merged in, plus the
// headline numbers for the top of Kirstie's dashboard. Gate: pre-tenancy
// role or admin (Susan can look over Kirstie's board).

// How long the board will wait on photos before rendering without them. The
// walk keeps going after this and fills the cache, so a first load that misses
// the deadline costs one photo-less render and nothing after it.
const PHOTO_DEADLINE_MS = 2_500;

export interface PreTenancyDeal {
  // AgentApplication fields the board renders, via the same shape the agent sees
  app: import("@/lib/rex-stats").AgentApplication;
  /** Live RAW Propoly status (start_deal … cancelled). */
  statusKey: string;
  /** Move-in slipped 30+ days and not reactivated — hidden from the stages. */
  archived: boolean;
  /** PORTAL stage (8-stage pipeline) after any still-valid stage move. */
  effectiveStatusKey: string;
  agentName: string | null;
  agentEmail: string | null;
  portal: DealPortalOverlay;
  /**
   * What the landlord actually bought — "Fully managed", "Let only",
   * "Rent collect" — from PayProp, which is the only place in the estate that
   * records it reliably (562 properties, 4 blank). null means we genuinely do
   * not know: either PayProp has no matching property, or two properties share
   * this address key and disagree. It is never a guess.
   */
  serviceLevel: string | null;
  /** RLP (the business says PLC) from PayProp payment instructions. null =
   *  not recorded either way — silence, never "no cover". */
  rlp: { status: "protected" | "without"; evidence: string } | null;
  /** The live tenancy PayProp holds for this address — deposit reference and
   *  actual start date. null = no unambiguous match, not "no tenancy". */
  tenancy: { startDate: string | null; depositId: string | null } | null;
  /** Landlord Terms-of-Business signing state from REX's DocuSign log, via
   *  the matched listing. null = no envelope found for the listing. */
  tobStatus: TobStatus | null;
}

export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user || (!isPreTenancyEmail(user.email) && !isAdminEmail(user.email))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The photo index starts HERE, alongside Propoly, not after it. It needs
  // nothing from the deals, and it is much the slower of the two — kicking it
  // off later just added its time to Propoly's. Timed 2 Aug 2026: Propoly ~1s,
  // the index ~10s cold, and they were running one after the other.
  const photosWork = getBusinessPhotoIndex(PHOTO_DEADLINE_MS).catch(() => null);
  // Cached an hour and non-blocking by design — it serves what it has and
  // refreshes behind. Started here so it overlaps Propoly like the photos do.
  const bookWork = getPortfolioBook().catch(() => null);
  // Same serve-stale contract as the book: these return instantly from cache
  // and refresh behind. A null register costs badges, never the board.
  const registerWork = getTenancyRegister().catch(() => null);
  const tobWork = getTobRegister().catch(() => null);

  const [deals, forecast] = await Promise.all([
    getAllPropolyDeals().catch(() => null),
    getPropolyMoveInForecast().catch(() => null),
  ]);
  if (deals == null) {
    // Distinguish "no keys" from "cold cache didn't warm inside the deadline"
    // — the client retries the latter instead of claiming Propoly is missing.
    const { propolyConfigured } = await import("@/lib/propoly");
    return NextResponse.json({
      configured: propolyConfigured(),
      deals: null,
      summary: null,
    });
  }

  const overlays = await getOverlays(deals.map((d) => d.app.id));
  const today = new Date().toISOString().slice(0, 10);
  const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Propoly holds no photos, so borrow them from REX by postcode and street
  // number — the same match the agent Applications page uses. Business-wide
  // here, because Kirstie sees every agent's deals and is not an agent
  // herself, so the per-agent index has nothing to match against.
  //
  // Never blocks the board: a failed or slow index just means deals arrive
  // without a picture, which is exactly what they do today. Started above so
  // it overlaps the Propoly fetch; by here it is usually already done.
  const photos = await photosWork;
  const book = await bookWork;
  const register = await registerWork;
  const tob = await tobWork;

  const out: PreTenancyDeal[] = deals.map((d) => {
    const entry = overlays.get(d.app.id);
    const meta = entry?.meta ?? null;
    const effective = effectivePortalStage(d.statusKey, meta);
    const overlay: DealPortalOverlay = entry
      ? {
          ...entry.overlay,
          // A stage move Propoly has since overtaken is stale — don't show it.
          override: effective === portalStageOf(d.statusKey) ? null : entry.overlay.override,
        }
      : { notesCount: 0, lastNote: null, override: null, checklistDone: 0, checklistTotal: 0 };
    const match = photos ? matchListingPhoto(photos, d.app.propertyName, d.app.locality) : null;
    // Address-keyed, because a Propoly deal holds an address string and no
    // PayProp id. Keys where two properties disagree were dropped upstream, so
    // a hit here is unambiguous or it is absent.
    const key = propertyKey(d.app.propertyName);
    const rlpHit = key ? register?.rlpByKey[key] : undefined;
    // The PayProp tenancy at this address is usually the SITTING tenant, not
    // this deal's — attaching it unqualified made "DEPOSIT HELD" claim a
    // deposit the new deal doesn't have yet (review find). Attach only when
    // the tenancy start sits within 60 days of the deal's move-in, i.e. it
    // plausibly IS this deal, registered after completion.
    const tenancyRaw = key ? register?.tenancyByKey[key] : undefined;
    const withinWindow =
      tenancyRaw?.startDate != null &&
      d.app.startDate != null &&
      Math.abs(
        (new Date(tenancyRaw.startDate).getTime() -
          new Date(d.app.startDate).getTime()) /
          86_400_000
      ) <= 60;
    const tenancyHit = withinWindow ? tenancyRaw : undefined;
    // ToB rides the CONFIDENT matcher, not the photo one — the photo match
    // deliberately falls back to "same postcode, best guess", which is fine
    // for a picture and wrong for a signing status (review find).
    const confident = photos
      ? matchListingConfident(photos, d.app.propertyName, d.app.locality)
      : null;
    return {
      serviceLevel: (key && book?.serviceLevelByKey[key]) || null,
      // disabledOnly evidence is excluded outright: the census found two
      // properties whose only RLP wording sits on a switched-off instruction,
      // and a dead instruction is not a statement about cover.
      rlp:
        rlpHit && !rlpHit.disabledOnly
          ? { status: rlpHit.status, evidence: rlpHit.evidence }
          : null,
      tenancy: tenancyHit
        ? { startDate: tenancyHit.startDate, depositId: tenancyHit.depositId }
        : null,
      tobStatus: (confident?.listingId && tob?.[confident.listingId]) || null,
      app: match
        ? { ...d.app, image: match.image, images: match.images, listingId: match.listingId }
        : d.app,
      statusKey: d.statusKey,
      effectiveStatusKey: effective,
      agentName: d.managerName,
      agentEmail: d.managerEmail,
      portal: overlay,
      // Archived: the move-in slipped more than 30 days and nobody has pulled
      // it back. A rule rather than a stored state — but a deal Kirstie has
      // reactivated stays out of the pile until it slips another 30 days from
      // whenever its date is next set.
      archived:
        meta?.unarchivedAt == null &&
        d.statusKey !== "complete" &&
        d.statusKey !== "cancelled" &&
        d.app.startDate != null &&
        d.app.startDate < THIRTY_DAYS_AGO,
    };
  });

  const active = out.filter(
    (d) => d.statusKey !== "cancelled" && d.statusKey !== "complete"
  );
  const summary = {
    pipelineTotal: active.length,
    byStage: PORTAL_STAGES.map((s) => ({
      key: s.key,
      label: s.label,
      count: active.filter((d) => d.effectiveStatusKey === s.key).length,
    })),
    overdue: active.filter((d) => d.app.startDate != null && d.app.startDate < today).length,
    undated: active.filter((d) => d.app.startDate == null).length,
    completedMtd: forecast?.completedMtd ?? null,
    forecastByMonth: forecast?.forecastByMonth ?? null,
    // How often the address join actually lands. PayProp records the service
    // level on 562 properties with only 4 blank, but that is the PayProp side;
    // what matters here is how many PROPOLY deals can be tied to one of them,
    // and that is a different number. Reported rather than assumed — the photo
    // index looked complete for months on exactly this kind of unmeasured join.
    serviceLevelCoverage: {
      known: active.filter((d) => d.serviceLevel != null).length,
      total: active.length,
      bookLoaded: book != null,
      ambiguousKeys: book?.serviceLevelAmbiguous.length ?? null,
    },
  };

  return NextResponse.json({ configured: true, deals: out, summary });
}
