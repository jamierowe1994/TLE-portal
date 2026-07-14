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
import type { AgentListing } from "@/lib/rex-stats";

const enterAt = (ms: number) =>
  ({ "--enter-delay": `${ms}ms` }) as React.CSSProperties;

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
      className="enter enter-up card btn-press flex overflow-hidden text-left transition hover:border-black/20"
      style={enterAt(delay)}
    >
      <div className="flex min-w-0 flex-1 flex-col p-4">
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

        <h3 className="mt-2 truncate text-[14px] font-semibold leading-snug">{l.name}</h3>
        <p className="truncate text-[12px] text-muted">{l.locality}</p>

        <div className="mt-auto flex items-baseline gap-1 pt-3">
          <span className="stat-value text-[20px]">
            {l.rent != null ? formatGBP(l.rent) : (l.advertisedAs ?? "—")}
          </span>
          <span className="text-[11px] text-muted">
            / {(l.rentPeriod ?? "month").toLowerCase()}
          </span>
        </div>
      </div>

      <div className="relative w-[38%] shrink-0 self-stretch border-l border-line">
        <Photo l={l} />
        {l.imageCount > 1 ? (
          <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            {l.imageCount}
          </span>
        ) : null}
      </div>
    </button>
  );
}

/* -------------------------------- drawer -------------------------------- */

function StepRow({ s }: { s: Step }) {
  const p = s.platformId ? platformById(s.platformId) : undefined;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line p-3">
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

function Drawer({ l, onClose }: { l: AgentListing; onClose: () => void }) {
  const stage = stageOf(l);
  const epc = epcState(l);
  const steps = stepsFor(l, stage);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="modal-pop my-auto w-full max-w-lg overflow-hidden rounded-2xl bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-44 w-full">
          <Photo l={l} />
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white backdrop-blur-sm transition hover:bg-black/70"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="p-5">
          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${STAGE_STYLE[stage]}`}>
            {STAGE_LABEL[stage]}
          </span>
          <h2 className="mt-2 text-[17px] font-semibold leading-snug">{l.name}</h2>
          <p className="text-[13px] text-muted">{l.locality}</p>

          <div className="mt-4 grid grid-cols-3 gap-3 border-y border-line py-3 text-[11px] text-muted">
            <div>
              <div className="stat-value text-[18px] text-ink">
                {l.rent != null ? formatGBP(l.rent) : "—"}
              </div>
              per {(l.rentPeriod ?? "month").toLowerCase()}
            </div>
            <div>
              <div className="text-[13px] font-medium text-ink">
                {l.availableFrom ?? "—"}
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
          <div className="mt-4 flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${epcNeedsWork(epc.state) ? "bg-amber-500" : "bg-emerald-500"}`}
            />
            <span className="text-[12px] text-muted">{epc.label}</span>
            {l.epcRating != null ? (
              <span className="text-[12px] text-muted">· rating {l.epcRating}</span>
            ) : null}
          </div>

          {/* Next steps — only what this stage actually needs */}
          <div className="mt-5">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
              {steps.length ? "What's next" : "Nothing outstanding"}
            </h3>
            {steps.length ? (
              <div className="mt-2 space-y-2">
                {steps.map((s) => (
                  <StepRow key={s.title} s={s} />
                ))}
                <p className="pt-1 text-[11px] text-muted">
                  These aren&rsquo;t ticked off automatically yet — once the
                  PayProp, Flatfair and Propoly connections are live, this list
                  will know what&rsquo;s already done.
                </p>
              </div>
            ) : (
              <p className="mt-1 text-[13px] text-muted">
                Nothing needs doing on this one right now.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
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

  const all = listings ?? [];
  const needs = all.filter((l) => stepsFor(l, stageOf(l)).length > 0).length;

  return (
    <div className="space-y-5">
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
        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card h-36 animate-pulse" />
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

          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
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
