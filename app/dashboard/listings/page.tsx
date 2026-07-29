"use client";

// My Properties — the agent's live REX listings.
//
// Progressive reveal: the tile carries only what you need to pick a property out
// of a list (status, name, address, rent, photo). Everything else — where the
// let is up to, what's outstanding, which platform does the next bit — lives
// behind the click, so the grid stays scannable.

import { useEffect, useState } from "react";
import { formatGBP } from "@/lib/format";
import { platformById } from "@/lib/platforms";
import { rexListingUrl } from "@/lib/rex-links";
import SplitDrawer, { DrawerPanel } from "@/components/SplitDrawer";
import PhotoCarousel from "@/components/PhotoCarousel";
import type { AgentListing } from "@/lib/rex-stats";

const enterAt = (ms: number) =>
  ({ "--enter-delay": `${ms}ms` }) as React.CSSProperties;

// "2026-09-07" → "7 Sep 2026" — REX dates arrive as raw ISO.
function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/* ------------------------------- the stage ------------------------------- */

type Stage = "draft" | "on-market" | "let-agreed";

function stageOf(l: AgentListing): Stage {
  if (l.publicationStatus?.toLowerCase() === "draft") return "draft";
  if (l.letAgreed) return "let-agreed";
  return "on-market";
}

const STAGE_LABEL: Record<Stage, string> = {
  draft: "DRAFT",
  "on-market": "ON MARKET",
  "let-agreed": "LET AGREED",
};

const STAGE_STYLE: Record<Stage, string> = {
  draft: "border-amber-200 bg-amber-50 text-amber-700",
  "on-market": "border-line bg-page text-muted",
  "let-agreed": "border-green-200 bg-green-50 text-green-700",
};

/* -------------------------------- EPC ---------------------------------- */

type EpcState = "valid" | "expiring" | "expired" | "missing" | "not-required";

function epcState(l: AgentListing): { state: EpcState; label: string } {
  if (l.epcNotRequired) return { state: "not-required", label: "EPC not required" };
  if (!l.epcExpiry) return { state: "missing", label: "No EPC on file" };
  const days = Math.round((new Date(l.epcExpiry).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { state: "expired", label: "EPC expired" };
  if (days <= 60) return { state: "expiring", label: `EPC expires in ${days} days` };
  return { state: "valid", label: `EPC valid to ${l.epcExpiry}` };
}

const epcNeedsWork = (s: EpcState) =>
  s === "expired" || s === "expiring" || s === "missing";

/* ------------------------------ next steps ------------------------------ */

interface Step {
  title: string;
  why: string;
  platformId?: string;
}

// Only ever the steps for where this property actually is — that's the point.
function stepsFor(l: AgentListing, stage: Stage): Step[] {
  const steps: Step[] = [];

  if (epcNeedsWork(epcState(l).state)) {
    steps.push({
      title: "Sort the EPC",
      why: "A valid EPC is a legal requirement before you can let it.",
      platformId: "rex",
    });
  }

  if (stage === "draft") {
    if (l.imageCount === 0) {
      steps.push({
        title: "Add photos",
        why: "It won't go live on the portals without them.",
        platformId: "rex",
      });
    }
    steps.push({
      title: "Publish the listing",
      why: "It's still a draft — nobody can see it yet.",
      platformId: "rex",
    });
  }

  if (stage === "let-agreed") {
    steps.push(
      {
        title: "Register the deposit",
        why: "Or set up the flatbond if they're going deposit-free.",
        platformId: "flatfair",
      },
      {
        title: "Book the inventory",
        why: "Needs doing before check-in.",
        platformId: "inventorybase",
      },
      {
        title: "Set up rent collection",
        why: "So the first payment lands on time.",
        platformId: "payprop",
      },
      {
        title: "Run the tenancy paperwork",
        why: "Referencing, Right to Rent and the agreement.",
        platformId: "propoly",
      }
    );
  }

  return steps;
}

/* -------------------------------- photo -------------------------------- */

function Photo({ l, rounded }: { l: AgentListing; rounded?: string }) {
  if (!l.image) {
    return (
      <div className={`flex h-full w-full flex-col items-center justify-center gap-1 bg-page text-muted ${rounded ?? ""}`}>
        <svg className="h-5 w-5 opacity-40" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <rect x={3} y={5} width={18} height={14} rx={2} />
          <path d="M3 15l5-5 4 4 3-3 6 6" />
          <circle cx={8.5} cy={9.5} r={1} />
        </svg>
        <span className="text-[10px]">No photos</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={l.image}
      alt={l.name}
      loading="lazy"
      className={`h-full w-full object-cover ${rounded ?? ""}`}
    />
  );
}

/* --------------------------------- tile --------------------------------- */

function ListingTile({
  l,
  delay,
  onOpen,
}: {
  l: AgentListing;
  delay: number;
  onOpen: () => void;
}) {
  const stage = stageOf(l);
  const attention = epcNeedsWork(epcState(l).state);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="enter enter-up card btn-press flex min-h-[210px] text-left transition hover:border-black/20"
      style={enterAt(delay)}
    >
      <div className="flex min-w-0 flex-1 flex-col p-6">
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${STAGE_STYLE[stage]}`}>
            {STAGE_LABEL[stage]}
          </span>
          {attention ? (
            <span
              className="h-1.5 w-1.5 rounded-full bg-amber-500"
              title="Something needs attention"
            />
          ) : null}
        </div>

        <h3 className="mt-3.5 truncate text-[14px] font-semibold leading-snug">{l.name}</h3>
        <p className="mt-0.5 truncate text-[12px] text-muted">{l.locality}</p>

        <div className="mt-auto flex items-baseline gap-1 pt-4">
          <span className="stat-value text-[21px]">
            {l.rent != null ? formatGBP(l.rent) : (l.advertisedAs ?? "—")}
          </span>
          <span className="text-[11px] text-muted">
            / {(l.rentPeriod ?? "month").toLowerCase()}
          </span>
        </div>
      </div>

      {/* The photo sits inset, so the card's own white reads as a border around
          it. Cropped to fill — a slight crop beats letterboxing. */}
      <div className="w-[38%] shrink-0 p-3 pl-0">
        <div className="relative h-full w-full overflow-hidden rounded-xl bg-page">
          <Photo l={l} />
          {l.imageCount > 1 ? (
            <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
              {l.imageCount}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/* -------------------------------- drawer -------------------------------- */

function StepRow({ s }: { s: Step }) {
  const p = s.platformId ? platformById(s.platformId) : undefined;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line p-4">
      <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-line" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{s.title}</p>
        <p className="mt-0.5 text-[12px] text-muted">{s.why}</p>
      </div>
      {p?.url ? (
        <a
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-press shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white"
          style={{ background: p.accent }}
        >
          {p.name} ↗
        </a>
      ) : p ? (
        <span className="shrink-0 text-[11px] text-muted">{p.name}</span>
      ) : null}
    </div>
  );
}

// Two windows: the property on the left, what to do about it on the right.
function Drawer({ l, onClose }: { l: AgentListing; onClose: () => void }) {
  const stage = stageOf(l);
  const epc = epcState(l);
  const steps = stepsFor(l, stage);

  return (
    <SplitDrawer onClose={onClose}>
      {/* ---- the property ---- */}
      <DrawerPanel className="p-3 lg:w-[26rem]">
        <PhotoCarousel images={l.images} alt={l.name} />

        <div className="p-5 sm:p-6">
          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${STAGE_STYLE[stage]}`}>
            {STAGE_LABEL[stage]}
          </span>
          <h2 className="mt-3 text-[17px] font-semibold leading-snug">{l.name}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{l.locality}</p>

          {/* Straight through to the record in REX — no hunting by address. */}
          <a
            href={rexListingUrl(l.id, "rental")}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-press mt-4 inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-white transition hover:opacity-90"
          >
            View Listing
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
          </a>

          <div className="mt-6 grid grid-cols-3 gap-3 border-y border-line py-5 text-[11px] text-muted">
            <div>
              <div className="stat-value text-[18px] text-ink">
                {l.rent != null ? formatGBP(l.rent) : "—"}
              </div>
              per {(l.rentPeriod ?? "month").toLowerCase()}
            </div>
            <div>
              <div className="text-[13px] font-medium text-ink">
                {fmtDate(l.availableFrom) ?? "—"}
              </div>
              Available from
            </div>
            <div>
              <div className="text-[13px] font-medium text-ink">
                {l.minTermMonths ? `${l.minTermMonths} months` : "—"}
              </div>
              Minimum term
            </div>
          </div>

          {/* Compliance — only shouts when it needs to */}
          <div className="mt-5 flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${epcNeedsWork(epc.state) ? "bg-amber-500" : "bg-emerald-500"}`}
            />
            <span className="text-[12px] text-muted">{epc.label}</span>
            {l.epcRating != null ? (
              <span className="text-[12px] text-muted">· rating {l.epcRating}</span>
            ) : null}
          </div>

          {/* The long tail lives behind a dropdown, so the box stays calm. */}
          <details className="group/details mt-5 rounded-xl border border-line">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[12px] font-semibold text-muted [&::-webkit-details-marker]:hidden">
              More details
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform group-open/details:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </summary>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line px-4 py-4 text-[12px]">
              {l.category ? (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Category</dt>
                  <dd className="mt-0.5 font-medium">{l.category}</dd>
                </div>
              ) : null}
              {l.letType ? (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Let type</dt>
                  <dd className="mt-0.5 font-medium">{l.letType}</dd>
                </div>
              ) : null}
              {l.publicationStatus ? (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Publication</dt>
                  <dd className="mt-0.5 font-medium">{l.publicationStatus}</dd>
                </div>
              ) : null}
              {l.advertisedAs ? (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Advertised as</dt>
                  <dd className="mt-0.5 font-medium">{l.advertisedAs}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">REX listing ID</dt>
                <dd className="mt-0.5 font-medium tabular-nums">{l.id}</dd>
              </div>
              {l.propertyId ? (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">REX property ID</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">{l.propertyId}</dd>
                </div>
              ) : null}
            </dl>
          </details>
        </div>
      </DrawerPanel>

      {/* ---- what you need to do ---- */}
      <DrawerPanel className="lg:w-[24rem]">
        <div className="p-5 sm:p-6">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
            {steps.length ? "What's next" : "Nothing outstanding"}
          </h3>
          {steps.length ? (
            <div className="mt-3 space-y-2.5">
              {steps.map((s) => (
                <StepRow key={s.title} s={s} />
              ))}
              <p className="pt-2 text-[11px] text-muted">
                These aren&rsquo;t ticked off automatically yet — once the
                PayProp, Flatfair and Propoly connections are live, this list
                will know what&rsquo;s already done.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-muted">
              Nothing needs doing on this one right now.
            </p>
          )}
        </div>
      </DrawerPanel>
    </SplitDrawer>
  );
}

/* --------------------------------- page --------------------------------- */

export default function ListingsPage() {
  const [listings, setListings] = useState<AgentListing[] | null>(null);
  const [linked, setLinked] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<AgentListing | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/my/listings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { linked?: boolean; listings?: AgentListing[]; error?: string }) => {
        if (cancelled) return;
        setLinked(d.linked !== false);
        setListings(d.listings ?? []);
        setError(d.error ?? null);
      })
      .catch(() => !cancelled && setError("Couldn't load your properties."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Deep link from the rail search: /dashboard/listings?open=<listingId> pops
  // that property's drawer once the data is in.
  useEffect(() => {
    if (!listings) return;
    const id = new URLSearchParams(window.location.search).get("open");
    if (!id) return;
    const match = listings.find((l) => l.id === id);
    if (match) setOpen(match);
  }, [listings]);

  const all = listings ?? [];
  const needs = all.filter((l) => stepsFor(l, stageOf(l)).length > 0).length;

  return (
    <div className="space-y-6">
      <div className="enter enter-up" style={enterAt(60)}>
        <h1 className="text-xl font-semibold tracking-tight">My properties</h1>
        <p className="mt-1 text-[13px] text-muted">
          Everything on the market or let agreed. Tap one to see where it&rsquo;s up
          to and what&rsquo;s next.
        </p>
      </div>

      {!linked ? (
        <div className="card accent-soft-bg border-red-100 p-4 text-[13px]">
          <span className="font-semibold accent-text">Your REX account isn&apos;t linked yet.</span>{" "}
          <span className="text-ink">Ask the admin to link your profile.</span>
        </div>
      ) : null}

      {error ? <div className="card p-6 text-center text-sm text-muted">{error}</div> : null}

      {loading ? (
        <div className="grid gap-6 sm:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card h-[210px] animate-pulse" />
          ))}
        </div>
      ) : linked && !error && all.length === 0 ? (
        <div className="card p-10 text-center text-[13px] text-muted">
          Nothing on the market at the moment.
        </div>
      ) : all.length > 0 ? (
        <>
          {needs > 0 ? (
            <div className="enter enter-up card border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800" style={enterAt(140)}>
              <span className="font-semibold">
                {needs} {needs === 1 ? "property has" : "properties have"} something outstanding
              </span>{" "}
              — tap through to see what.
            </div>
          ) : null}

          <div className="grid gap-6 sm:grid-cols-2 2xl:grid-cols-3">
            {all.map((l, i) => (
              <ListingTile key={l.id} l={l} delay={200 + i * 50} onOpen={() => setOpen(l)} />
            ))}
          </div>
        </>
      ) : null}

      {open ? <Drawer l={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
