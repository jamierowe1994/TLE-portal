"use client";

// My Portfolio — the properties the agent has let and now manages (REX
// "leased"), the step after My Properties → Applications → Compliance.
//
// Same shape as Compliance on purpose: tile → click → drawer. The tile says
// how the property is doing (renewals outstanding, rent, how long it's been on
// the book); the drawer says exactly what's due and links straight out to the
// REX record by id. Maintenance jobs live in REX PM (Alfie) — we link there
// rather than pretend to mirror it.

import { useEffect, useState } from "react";
import Loader from "@/components/Loader";
import NoPhoto from "@/components/NoPhoto";
import { rexListingUrl } from "@/lib/rex-links";
import SplitDrawer, { DrawerPanel } from "@/components/SplitDrawer";
import PhotoCarousel from "@/components/PhotoCarousel";
import type { ComplianceItem, ComplianceState, PortfolioProperty } from "@/lib/rex-stats";

const enterAt = (ms: number) =>
  ({ "--enter-delay": `${ms}ms` }) as React.CSSProperties;

const REXPM_URL = "https://alfie.app.rexsoftware.com";

const needsWork = (s: ComplianceState) =>
  s === "expired" || s === "expiring" || s === "missing";

const STATE_STYLE: Record<ComplianceState, string> = {
  expired: "border-red-200 bg-red-50 text-red-700",
  expiring: "border-amber-200 bg-amber-50 text-amber-700",
  missing: "border-amber-200 bg-amber-50 text-amber-700",
  valid: "border-line bg-page text-muted",
  "not-required": "border-line bg-page text-muted",
};

const STATE_DOT: Record<ComplianceState, string> = {
  expired: "bg-red-500",
  expiring: "bg-amber-500",
  missing: "bg-amber-500",
  valid: "bg-emerald-500",
  "not-required": "bg-gray-300",
};

function stateLabel(i: ComplianceItem): string {
  switch (i.state) {
    case "expired":
      return `Expired ${i.expiry ?? ""}`.trim();
    case "expiring": {
      const days = i.expiry
        ? Math.round((new Date(i.expiry).getTime() - Date.now()) / 86_400_000)
        : null;
      return days != null ? `Expires in ${days} days` : "Expiring";
    }
    case "missing":
      return "Nothing on file";
    case "not-required":
      return "Not required";
    default:
      return i.expiry ? `Valid to ${i.expiry}` : "Recorded";
  }
}

function money(n: number | null): string | null {
  if (n == null) return null;
  return `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

// "Mar 2024 · 2 yrs 4 mos" — how long the property has been on the book.
function sinceLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const when = d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  let months = Math.floor((Date.now() - d.getTime()) / (30.44 * 86_400_000));
  if (months < 1) return `${when} · new this month`;
  const yrs = Math.floor(months / 12);
  months = months % 12;
  const dur = [
    yrs ? `${yrs} ${yrs === 1 ? "yr" : "yrs"}` : null,
    months ? `${months} ${months === 1 ? "mo" : "mos"}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return `${when} · ${dur}`;
}

function renewalLabel(p: PortfolioProperty): { text: string; urgent: boolean } | null {
  if (!p.nextRenewal) return null;
  const days = Math.round(
    (new Date(p.nextRenewal.expiry).getTime() - Date.now()) / 86_400_000
  );
  if (days < 0)
    return { text: `${p.nextRenewal.label} overdue`, urgent: true };
  if (days <= 60)
    return { text: `${p.nextRenewal.label} due in ${days}d`, urgent: true };
  return { text: `Next: ${p.nextRenewal.label} ${p.nextRenewal.expiry}`, urgent: false };
}

/* -------------------------------- photo -------------------------------- */

function Photo({ image, alt }: { image: string | null; alt: string }) {
  if (!image) {
    return <NoPhoto />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={image} alt={alt} loading="lazy" className="h-full w-full object-cover" />;
}

/* --------------------------------- tile --------------------------------- */

function PortfolioTile({
  p,
  delay,
  onOpen,
}: {
  p: PortfolioProperty;
  delay: number;
  onOpen: () => void;
}) {
  const worst: ComplianceState = p.items.some((i) => i.state === "expired")
    ? "expired"
    : p.outstanding > 0
      ? "expiring"
      : "valid";
  const renewal = renewalLabel(p);
  const since = sinceLabel(p.sinceISO);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="enter enter-up card btn-press flex min-h-[210px] text-left transition hover:border-black/20"
      style={enterAt(delay)}
    >
      <div className="flex min-w-0 flex-1 flex-col p-6">
        <span
          className={`w-fit rounded-full border px-2 py-0.5 text-[9px] font-semibold ${STATE_STYLE[worst]}`}
        >
          {p.outstanding > 0
            ? `${p.outstanding} RENEWAL${p.outstanding === 1 ? "" : "S"} DUE`
            : p.items.length
              ? "ALL IN DATE"
              : "NOTHING RECORDED"}
        </span>

        <h3 className="mt-3.5 truncate text-[14px] font-semibold leading-snug">{p.name}</h3>
        <p className="mt-0.5 truncate text-[12px] text-muted">{p.locality}</p>

        <p className="mt-2 truncate text-[12px] text-muted">
          {money(p.rent) ? (
            <span className="font-medium text-ink">{money(p.rent)} pcm</span>
          ) : null}
          {money(p.rent) && since ? " · " : null}
          {since ? `on the book since ${since}` : null}
        </p>

        <div className="mt-auto flex flex-wrap items-center gap-1 pt-4">
          {renewal ? (
            <span
              className={`truncate text-[11px] ${renewal.urgent ? "font-medium text-amber-700" : "text-muted"}`}
            >
              {renewal.text}
            </span>
          ) : (
            <span className="text-[11px] text-muted">No renewals on file</span>
          )}
        </div>
      </div>

      <div className="w-[38%] shrink-0 p-3 pl-0">
        <div className="relative h-full w-full overflow-hidden rounded-xl bg-page">
          <Photo image={p.image} alt={p.name} />
        </div>
      </div>
    </button>
  );
}

/* -------------------------------- drawer -------------------------------- */

// Two windows: the property (front-of-house) on the left, what needs doing on
// the right.
function Drawer({ p, onClose }: { p: PortfolioProperty; onClose: () => void }) {
  const outstanding = p.items.filter((i) => needsWork(i.state));
  const settled = p.items.filter((i) => !needsWork(i.state));
  const since = sinceLabel(p.sinceISO);

  return (
    <SplitDrawer onClose={onClose}>
      {/* ---- the property ---- */}
      <DrawerPanel className="p-3 lg:w-[26rem]">
        <PhotoCarousel images={p.images} alt={p.name} />

        <div className="p-5 sm:p-6">
          <h2 className="text-[17px] font-semibold leading-snug">{p.name}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{p.locality}</p>

          {/* The facts of the tenancy at a glance */}
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">
            {money(p.rent) ? (
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Rent</dt>
                <dd className="mt-0.5 text-[13px] font-medium">{money(p.rent)} pcm</dd>
              </div>
            ) : null}
            {since ? (
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">On the book</dt>
                <dd className="mt-0.5 text-[13px] font-medium">{since}</dd>
              </div>
            ) : null}
            {p.letType ? (
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Let type</dt>
                <dd className="mt-0.5 text-[13px] font-medium">{p.letType}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">REX listing ID</dt>
              <dd className="mt-0.5 text-[13px] font-medium tabular-nums">{p.listingId}</dd>
            </div>
            {p.propertyId ? (
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">REX property ID</dt>
                <dd className="mt-0.5 text-[13px] font-medium tabular-nums">{p.propertyId}</dd>
              </div>
            ) : null}
          </dl>

          {/* Straight out to the record */}
          <div className="mt-5 flex flex-wrap gap-2">
            <a
              href={rexListingUrl(p.listingId, "leased")}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-press inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-white transition hover:opacity-90"
            >
              View Listing
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7M9 7h8v8" />
              </svg>
            </a>
            <a
              href={REXPM_URL}
              target="_blank"
              rel="noreferrer"
              className="btn-press inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12px] font-semibold transition hover:border-black/20"
            >
              Maintenance in REX PM
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7M9 7h8v8" />
              </svg>
            </a>
          </div>

          <p className="mt-5 text-[11px] text-muted">
            Live from REX. Certificates and maintenance jobs are managed in REX /
            REX PM — this is the view, not the record.
          </p>
        </div>
      </DrawerPanel>

      {/* ---- what you need to do ---- */}
      <DrawerPanel className="lg:w-[24rem]">
        <div className="p-5 sm:p-6">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
            {outstanding.length ? "What you need to do" : "Nothing outstanding"}
          </h3>
          <p className="mt-2 text-[13px] text-muted">
            {outstanding.length ? (
              <>
                <span className="font-semibold text-ink">
                  {outstanding.length} {outstanding.length === 1 ? "item needs" : "items need"} attention
                </span>{" "}
                on this property.
              </>
            ) : p.items.length ? (
              "Everything on file is in date."
            ) : (
              "No compliance records against this property yet."
            )}
          </p>

          {outstanding.length ? (
            <div className="mt-4 space-y-2.5">
              {outstanding.map((i) => (
                <div
                  key={i.type}
                  className={`flex items-start gap-3 rounded-xl border p-4 ${STATE_STYLE[i.state]}`}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATE_DOT[i.state]}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-ink">{i.label}</p>
                    <p className="mt-0.5 text-[12px] text-muted">{stateLabel(i)}</p>
                    {i.notes ? (
                      <p className="mt-1 text-[11px] italic text-muted">{i.notes}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {settled.length ? (
            <div className="mt-6">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                In date
              </p>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                {settled.map((i) => (
                  <div
                    key={i.type}
                    title={i.notes ?? stateLabel(i)}
                    className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2"
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[i.state]}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-ink">
                        {i.label}
                      </span>
                      <span className="block truncate text-[10px] text-muted">
                        {stateLabel(i)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </DrawerPanel>
    </SplitDrawer>
  );
}

/* --------------------------------- page --------------------------------- */

export default function PortfolioPage() {
  const [properties, setProperties] = useState<PortfolioProperty[] | null>(null);
  const [linked, setLinked] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<PortfolioProperty | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/my/portfolio", { cache: "no-store" })
      .then((r) => r.json())
      .then(
        (d: { linked?: boolean; properties?: PortfolioProperty[]; error?: string }) => {
          if (cancelled) return;
          setLinked(d.linked !== false);
          setProperties(d.properties ?? []);
          setError(d.error ?? null);
        }
      )
      .catch(() => !cancelled && setError("Couldn't load your portfolio."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Deep link from the rail search: /dashboard/portfolio?open=<listingId> pops
  // that property's drawer once the data is in.
  useEffect(() => {
    if (!properties) return;
    const id = new URLSearchParams(window.location.search).get("open");
    if (!id) return;
    const match = properties.find((p) => p.listingId === id);
    if (match) setOpen(match);
  }, [properties]);

  const all = properties ?? [];
  const totalOutstanding = all.reduce((t, p) => t + p.outstanding, 0);
  const rentRoll = all.reduce((t, p) => t + (p.rent ?? 0), 0);

  return (
    // Same outline treatment as the rest of the portal.
    <div className="outline-cards space-y-6">
      <div className="enter enter-up" style={enterAt(60)}>
        <h1 className="text-xl font-semibold tracking-tight">My Portfolio</h1>
        <p className="mt-1 text-[13px] text-muted">
          The properties you&apos;ve let and now manage — renewals due, rent roll,
          and a straight line back to the record in REX.
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
        <Loader label="Loading your portfolio…" />
      ) : linked && !error && all.length === 0 ? (
        <div className="card p-10 text-center text-[13px] text-muted">
          Nothing in your managed portfolio yet — properties land here once
          they&apos;re let and marked leased in REX.
        </div>
      ) : all.length > 0 ? (
        <>
          <div
            className={`enter enter-up card p-4 text-[13px] ${
              totalOutstanding > 0
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "text-muted"
            }`}
            style={enterAt(140)}
          >
            <span className="font-semibold">
              {all.length} {all.length === 1 ? "property" : "properties"}
            </span>
            {rentRoll > 0 ? (
              <>
                {" "}
                · <span className="font-semibold">{money(rentRoll)}</span> rent roll a month
              </>
            ) : null}
            {totalOutstanding > 0 ? (
              <>
                {" "}
                ·{" "}
                <span className="font-semibold">
                  {totalOutstanding} {totalOutstanding === 1 ? "renewal" : "renewals"} due
                </span>
              </>
            ) : (
              <> · everything on file is in date</>
            )}
          </div>

          <div className="grid gap-6 sm:grid-cols-2 2xl:grid-cols-3">
            {all.map((p, i) => (
              <PortfolioTile
                key={p.listingId}
                p={p}
                delay={200 + i * 50}
                onOpen={() => setOpen(p)}
              />
            ))}
          </div>
        </>
      ) : null}

      {open ? <Drawer p={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
