import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { resolveRexUserId } from "@/lib/agent-link";
import {
  getAgentApplications,
  getAgentPhotoIndex,
  matchListingPhoto,
} from "@/lib/rex-stats";
import { getPropolyAgentDeals } from "@/lib/propoly-deals";
import { effectivePortalStage, getOverlays } from "@/lib/deal-store";
import { PORTAL_STAGE_BY_KEY, portalStageOf } from "@/lib/propoly-stages";

// The signed-in agent's let pipeline. Propoly (tenancy progression) is the
// primary source — it's the system actually running referencing and
// agreements, and deals match the agent via their property manager email.
// REX tenancy applications remain the fallback when Propoly isn't
// configured or can't be reached.
//
// GET /api/my/applications → { linked, applications, source?, error? }
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const propoly = await getPropolyAgentDeals({
    email: user.email,
    agentKey: user.agentKey ?? null,
  }).catch(() => null);
  if (propoly != null) {
    // Layer on the pre-tenancy overlay: Kirstie's notes, checklist progress
    // and any stage move — so her actions show up in the agent's file. Raw
    // Propoly statuses are translated onto the shared 8-stage portal
    // pipeline so the agent's board matches Kirstie's exactly.
    const overlays = await getOverlays(propoly.map((a) => a.id)).catch(() => null);

    // Propoly holds no photos, so borrow them from the same property in REX,
    // matched on postcode + street number. That match also hands us the
    // listing id, which is what makes the address clickable in the drawer.
    const rexId = await resolveRexUserId(user).catch(() => null);
    const photos = rexId ? await getAgentPhotoIndex(rexId).catch(() => null) : null;

    const applications = propoly.map((a) => {
      const match = photos ? matchListingPhoto(photos, a.propertyName, a.locality) : null;
      if (match) {
        a = { ...a, image: match.image, images: match.images, listingId: match.listingId };
      }
      if (!a.propoly) return a;
      const raw = a.propoly.statusKey;
      if (raw === "cancelled") return a;
      const entry = overlays?.get(a.id);
      const effective = entry ? effectivePortalStage(raw, entry.meta) : portalStageOf(raw);
      const moved = effective !== portalStageOf(raw);
      const info = PORTAL_STAGE_BY_KEY[effective];
      return {
        ...a,
        // A still-valid stage move changes what the agent sees everywhere.
        ...(info ? { stage: info.stage, status: info.label } : {}),
        propoly: { ...a.propoly, statusKey: effective },
        ...(entry
          ? {
              portal: {
                ...entry.overlay,
                override: moved ? entry.overlay.override : null,
              },
            }
          : {}),
      };
    });
    return NextResponse.json({
      linked: true,
      applications,
      source: "propoly",
    });
  }

  const rexUserId = await resolveRexUserId(user);
  if (!rexUserId) {
    return NextResponse.json({ linked: false, applications: [] });
  }

  const applications = await getAgentApplications(rexUserId);
  if (applications == null) {
    // Never imply an empty pipeline when we simply couldn't ask.
    return NextResponse.json({
      linked: true,
      applications: [],
      error: "Couldn't reach REX just now — your pipeline will be back shortly.",
    });
  }
  return NextResponse.json({ linked: true, applications, source: "rex" });
}
