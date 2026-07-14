"use client";

// My Properties — the agent's live REX listings, laid out to be read at a
// glance rather than dug out of REX's own screens. Live data, agent-scoped.

import { useEffect, useState } from "react";
import { formatGBP, formatNum } from "@/lib/format";
import type { AgentListing } from "@/lib/rex-stats";

const enterAt = (ms: number) =>
  ({ "--enter-delay": `${ms}ms` }) as React.CSSProperties;

/* ------------------------------ EPC status ------------------------------ */

type EpcState = "valid" | "expiring" | "expired" | "missing" | "not-required";

function epcState(l: AgentListing): { state: EpcState; label: string } {
  if (l.epcNotRequired) return { state: "not-required", label: "EPC not required" };
  if (!l.epcExpiry) return { state: "missing", label: "No EPC" };
  const days = Math.round(
    (new Date(l.epcExpiry).getTime() - Date.now()) / 86_400_000
  );
  if (days < 0) return { state: "expired", label: "EPC expired" };
  if (days <= 60) return { state: "expiring", label: `EPC expires in ${days}d` };
  return { state: "valid", label: `EPC to ${l.epcExpiry.slice(0, 4)}` };
}

const EPC_STYLE: Record<EpcState, string> = {
  valid: "border-line bg-page text-muted",
  expiring: "border-amber-200 bg-amber-50 text-amber-700",
  expired: "border-red-200 bg-red-50 text-red-700",
  missing: "border-amber-200 bg-amber-50 text-amber-700",
  "not-required": "border-line bg-page text-muted",
};

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/* -------------------------------- the card ------------------------------- */

/** Photo on the right; a quiet placeholder when REX has none (usually drafts). */
function ListingPhoto({ l }: { l: AgentListing }) {
  if (!l.image) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-page text-muted">
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
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={l.image}
        alt={l.address}
        loading="lazy"
        className="h-full w-full object-cover"
      />
      {l.imageCount > 1 ? (
        <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          {l.imageCount}
        </span>
      ) : null}
    </>
  );
}

function ListingCard({ l, delay }: { l: AgentListing; delay: number }) {
  const epc = epcState(l);
  const available = fmtDate(l.availableFrom);
  return (
    <div className="enter enter-up card flex overflow-hidden" style={enterAt(delay)}>
      {/* ---- info, left ---- */}
      <div className="flex min-w-0 flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[14px] font-semibold leading-snug">{l.address}</h3>
          {l.letAgreed ? (
            <span className="shrink-0 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
              LET AGREED
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-line bg-page px-2 py-0.5 text-[10px] font-semibold text-muted">
              ON MARKET
            </span>
          )}
        </div>

        <div className="mt-2.5 flex items-baseline gap-2">
          <span className="stat-value text-[24px]">
            {l.rent != null ? formatGBP(l.rent) : (l.advertisedAs ?? "—")}
          </span>
          {l.rentPeriod ? (
            <span className="text-[12px] text-muted">/ {l.rentPeriod.toLowerCase()}</span>
          ) : null}
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${EPC_STYLE[epc.state]}`}>
            {epc.label}
          </span>
          {l.publicationStatus?.toLowerCase() === "draft" ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              Draft — not published
            </span>
          ) : null}
          {l.letType ? (
            <span className="rounded-full border border-line bg-page px-2 py-0.5 text-[10px] font-medium text-muted">
              {l.letType}
            </span>
          ) : null}
        </div>

        <div className="mt-auto grid grid-cols-2 gap-2 pt-3 text-[11px] text-muted">
          <div>
            <div className="font-medium text-ink">{available ?? "—"}</div>
            Available from
          </div>
          <div>
            <div className="font-medium text-ink">
              {l.minTermMonths != null ? `${l.minTermMonths} months` : "—"}
            </div>
            Minimum term
          </div>
        </div>
      </div>

      {/* ---- photo, right ---- */}
      <div className="relative w-[38%] shrink-0 self-stretch border-l border-line">
        <ListingPhoto l={l} />
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
  const letAgreed = all.filter((l) => l.letAgreed).length;
  const onMarket = all.length - letAgreed;
  const rent = all.reduce((t, l) => t + (l.rent ?? 0), 0);
  const needsEpc = all.filter((l) => {
    const s = epcState(l).state;
    return s === "expired" || s === "expiring" || s === "missing";
  }).length;

  return (
    <div className="space-y-5">
      <div className="enter enter-up" style={enterAt(60)}>
        <h1 className="text-xl font-semibold tracking-tight">My properties</h1>
        <p className="mt-1 text-[13px] text-muted">
          Everything you have on the market or let agreed right now — live from REX.
        </p>
      </div>

      {!linked ? (
        <div className="card accent-soft-bg border-red-100 p-4 text-[13px]">
          <span className="font-semibold accent-text">Your REX account isn&apos;t linked yet.</span>{" "}
          <span className="text-ink">
            Ask the admin to link your profile and your properties will appear here.
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="card p-6 text-center text-sm text-muted">{error}</div>
      ) : null}

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card h-44 animate-pulse" />
          ))}
        </div>
      ) : linked && !error && all.length === 0 ? (
        <div className="card p-10 text-center text-[13px] text-muted">
          Nothing on the market at the moment. New listings appear here as soon as
          they&rsquo;re live in REX.
        </div>
      ) : all.length > 0 ? (
        <>
          {/* Summary strip */}
          <section className="enter enter-up grid grid-cols-2 gap-3 lg:grid-cols-4" style={enterAt(140)}>
            <div className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Live properties</div>
              <div className="stat-value mt-1 text-[24px]">{formatNum(all.length)}</div>
            </div>
            <div className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">On market</div>
              <div className="stat-value mt-1 text-[24px]">{formatNum(onMarket)}</div>
            </div>
            <div className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Let agreed</div>
              <div className="stat-value mt-1 text-[24px]">{formatNum(letAgreed)}</div>
            </div>
            <div className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Combined rent</div>
              <div className="stat-value mt-1 text-[24px]">{formatGBP(rent)}</div>
              <div className="mt-0.5 text-[11px] text-muted">per month, advertised</div>
            </div>
          </section>

          {needsEpc > 0 ? (
            <div className="enter enter-up card border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800" style={enterAt(200)}>
              <span className="font-semibold">
                {needsEpc} {needsEpc === 1 ? "property needs" : "properties need"} an EPC looking at
              </span>{" "}
              — expired, expiring within 60 days, or missing.
            </div>
          ) : null}

          {/* Tiles carry a photo alongside the detail, so they need more width
              than a plain stat card — two up, three only on very wide screens. */}
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {all.map((l, i) => (
              <ListingCard key={l.id} l={l} delay={260 + i * 60} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
