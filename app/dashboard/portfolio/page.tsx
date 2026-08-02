"use client";

// My Portfolio — the properties the agent has let and now manages (REX
// "leased"), the step after My Properties → Applications → Compliance.
//
// Same shape as Compliance on purpose: tile → click → drawer. The tile says
// how the property is doing (renewals outstanding, rent, how long it's been on
// the book); the drawer says exactly what's due and links straight out to the
// REX record by id. Maintenance jobs live in REX PM (Alfie) — we link there
// rather than pretend to mirror it.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DoodleIcon from "@/components/DoodleIcon";
import CollapsePanel, { PANEL_STAGGER } from "@/components/CollapsePanel";
import PropertyNotes from "@/components/PropertyNotes";
import FilterBar from "@/components/FilterBar";
import StatStrip from "@/components/StatStrip";
import QuickTabs from "@/components/QuickTabs";
import Loader from "@/components/Loader";
import NoPhoto from "@/components/NoPhoto";
import { rexListingUrl } from "@/lib/rex-links";
import SplitDrawer, { DrawerPanel } from "@/components/SplitDrawer";
import PhotoCarousel from "@/components/PhotoCarousel";
import type { ComplianceItem, ComplianceState, PortfolioProperty } from "@/lib/rex-stats";
import { zoomOriginFrom, type ZoomOrigin } from "@/lib/zoom-origin";

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
  onOpen: (origin: ZoomOrigin) => void;
}) {
  // "Couldn't check" outranks everything, same as on Compliance: when REX's
  // answer was cut short we know nothing about this property, so both of the
  // reassuring badges below would be a guess dressed as a fact.
  const worst: ComplianceState = !p.checked
    ? "missing"
    : p.items.some((i) => i.state === "expired")
      ? "expired"
      : p.outstanding > 0
        ? "expiring"
        : "valid";
  const renewal = renewalLabel(p);
  const since = sinceLabel(p.sinceISO);

  return (
    <button
      type="button"
      onClick={(e) => onOpen(zoomOriginFrom(e))}
      className="enter enter-up card btn-press flex min-h-[210px] text-left transition hover:border-black/20"
      style={enterAt(delay)}
    >
      <div className="flex min-w-0 flex-1 flex-col p-6">
        <span
          className={`w-fit rounded-full border px-2 py-0.5 text-[9px] font-semibold ${STATE_STYLE[worst]}`}
        >
          {!p.checked
            ? "COULDN'T CHECK"
            : p.outstanding > 0
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
          ) : p.checked ? (
            <span className="text-[11px] text-muted">No renewals on file</span>
          ) : null}

          {/* The badge already says we don't know; this line would otherwise sit
              underneath it asserting the opposite. */}
          {!p.checked ? (
            <span className="w-full text-[11px] text-amber-700">
              REX didn&apos;t finish answering — there may be more
            </span>
          ) : null}
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
function Drawer({ p, onClose, origin }: { p: PortfolioProperty; onClose: () => void; origin?: ZoomOrigin }) {
  type Expanded = null | "indate" | "notes";
  const [expanded, setExpanded] = useState<Expanded>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && (expanded ? setExpanded(null) : onClose());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, onClose]);

  const outstanding = p.items.filter((i) => needsWork(i.state));
  const settled = p.items.filter((i) => !needsWork(i.state));
  const since = sinceLabel(p.sinceISO);

  // When REX's answer was cut short, every number on this screen is a count of
  // what we managed to read, not a total — so nothing may be labelled as one,
  // and no empty list may be worded as "there's nothing there".
  const partial = !p.checked;

  const collapse = (
    <button
      type="button"
      onClick={() => setExpanded(null)}
      className="btn-press rounded-full border border-line px-3 py-1 text-[12px] font-medium text-muted transition hover:text-ink"
    >
      Collapse
    </button>
  );

  return (
    <SplitDrawer onClose={onClose} hideClose origin={origin}>
      <DrawerPanel
        className="relative shrink-0 grow-0 p-5 sm:p-7"
        style={{ width: "min(74rem, calc(100vw - 2rem))" }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="btn-press absolute right-5 top-5 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-page text-muted transition hover:text-ink"
        >
          <DoodleIcon name="cross" size={16} />
        </button>

        {/* ---- top: photos left, the tenancy facts right ---- */}
        <div className="grid gap-7 lg:grid-cols-[1.05fr_1fr] lg:gap-9">
          <div className="min-w-0">
            <PhotoCarousel
              images={p.images}
              alt={p.name}
              aspect="h-60 sm:h-[17rem]"
              arrowsOutside
              thumbs
            />
          </div>

          <div className="min-w-0 pr-12">
            <Link
              href={`/dashboard/listings?open=${encodeURIComponent(p.listingId)}`}
              className="text-[24px] leading-tight tracking-tight decoration-2 underline-offset-4 hover:underline"
              style={{ fontWeight: 500 }}
            >
              {p.name}
            </Link>
            <p className="mt-1.5 text-[13px] text-muted">{p.locality}</p>

            <div className="mt-5 border-t border-line pt-5">
              <div className="flex items-end gap-2">
                <span className="stat-value text-[34px] leading-none" style={{ fontWeight: 300 }}>
                  {money(p.rent) ?? "—"}
                </span>
                <span className="pb-1 text-[13px] text-muted">pcm</span>
              </div>
              <p className="mt-2.5 text-[12.5px] text-muted">
                {since ? (
                  <>
                    On the book <span className="text-ink">{since}</span>
                  </>
                ) : null}
                {p.letType ? (
                  <>
                    {since ? "  ·  " : null}
                    <span className="text-ink">{p.letType}</span>
                  </>
                ) : null}
              </p>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-line px-4 py-3">
                <div className="text-[11px] text-muted">
                  {partial ? "Needs attention so far" : "Needs attention"}
                </div>
                <div className="stat-value mt-1 text-[19px] leading-none" style={{ fontWeight: 400 }}>
                  {p.outstanding}
                </div>
              </div>
              <div className="rounded-2xl border border-line px-4 py-3">
                <div className="text-[11px] text-muted">
                  {partial ? "Soonest we could see" : "Next renewal"}
                </div>
                <div className="mt-1 truncate text-[13px] font-medium text-ink">
                  {/* "None on file" here would read as "nothing is due" — on a
                      short read we simply never got that far. */}
                  {p.nextRenewal
                    ? `${p.nextRenewal.label} ${p.nextRenewal.expiry}`
                    : partial
                      ? "Unknown"
                      : "None on file"}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid items-stretch gap-5 lg:grid-cols-[1fr_1.08fr]">
          {/* ---- left: what needs doing ---- */}
          <div className="card p-5 sm:p-6">
            <h3 className="flex items-center gap-2 text-[15px]" style={{ fontWeight: 500 }}>
              <DoodleIcon name="shield" size={17} className="text-accent" />
              What needs doing
            </h3>

            {/* Said before the list, not after it: whatever follows is a partial
                answer, and the reader has to know that before they read it. */}
            {partial ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-800">
                REX cut us off part-way through this property, so anything below is
                what we managed to read — not necessarily everything on file. Open
                it in REX to be sure.
              </div>
            ) : null}

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
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[160px] items-center">
                <p
                  className="text-left font-light leading-tight tracking-tight text-ink"
                  style={{ fontSize: "clamp(26px, 2.4vw, 34px)" }}
                >
                  {/* An empty outstanding list only means "in date" if we got
                      the whole list — on a short read it means nothing. */}
                  {partial ? (
                    <>
                      Couldn&apos;t
                      <br />
                      check this one
                    </>
                  ) : (
                    <>
                      Everything
                      <br />
                      in date
                    </>
                  )}
                </p>
              </div>
            )}
          </div>

          {/* ---- right: panels that open over each other ---- */}
          <div className="flex flex-col">
            <CollapsePanel open={expanded === null} delay={expanded === null ? PANEL_STAGGER : 0}>
              <div className="grid gap-5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setExpanded("indate")}
                  className="card card-lift p-5 text-left"
                >
                  <h3 className="flex items-center gap-2 text-[14px]" style={{ fontWeight: 500 }}>
                    <DoodleIcon name="checklist" size={16} className="text-accent" />
                    In date
                  </h3>
                  {/* The card sitting beside "Couldn't check this one" can't
                      say "nothing recorded" — that's the reassuring half of a
                      drawer whose other half has already said we don't know. */}
                  <p className="mt-2 text-[12px] text-muted">
                    {settled.length
                      ? `${settled.length} item${settled.length === 1 ? "" : "s"} ${
                          partial ? "read so far" : "on file"
                        }`
                      : partial
                        ? "Couldn't check this one"
                        : "Nothing recorded yet"}
                  </p>
                  <span className="mt-3 inline-block text-[12px] font-medium text-ink underline-offset-2 hover:underline">
                    View all
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setExpanded("notes")}
                  className="card card-lift p-5 text-left"
                >
                  <h3 className="flex items-center gap-2 text-[14px]" style={{ fontWeight: 500 }}>
                    <DoodleIcon name="note" size={16} className="text-accent" />
                    Notes
                  </h3>
                  <p className="mt-2 text-[12px] text-muted">
                    Anything you or the team have logged
                  </p>
                  <span className="mt-3 inline-block text-[12px] font-medium text-ink underline-offset-2 hover:underline">
                    View all
                  </span>
                </button>
              </div>
            </CollapsePanel>

            <CollapsePanel
              open={expanded === "indate"}
              delay={expanded === "indate" ? PANEL_STAGGER : 0}
              grow={expanded === "indate"}
            >
              <div className="card flex h-full flex-col p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-[15px]" style={{ fontWeight: 500 }}>
                    <DoodleIcon name="checklist" size={17} className="text-accent" />
                    In date
                  </h3>
                  {collapse}
                </div>
                {/* Same caveat as the left card, said before the list rather
                    than after it. */}
                {partial ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">
                    REX didn&apos;t finish answering for this property
                    {settled.length
                      ? ", so this is what we could read — not the full list."
                      : ", and nothing in-date came back before it stopped. We can't say what's on file here — check it in REX."}
                  </div>
                ) : null}
                {settled.length ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {settled.map((i) => (
                      <div
                        key={i.type}
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
                ) : partial ? null : (
                  <p className="mt-4 text-[13px] text-muted">
                    Nothing on file for this property yet.
                  </p>
                )}
              </div>
            </CollapsePanel>

            <CollapsePanel
              open={expanded === "notes"}
              delay={expanded === "notes" ? PANEL_STAGGER : 0}
              grow={expanded === "notes"}
            >
              <div className="card flex h-full flex-col p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-[15px]" style={{ fontWeight: 500 }}>
                    <DoodleIcon name="note" size={17} className="text-accent" />
                    Notes
                  </h3>
                  {collapse}
                </div>
                <div className="mt-3 flex-1">
                  <PropertyNotes listingId={p.listingId} name={p.name} />
                </div>
              </div>
            </CollapsePanel>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-5">
          <a
            href={rexListingUrl(p.listingId, "leased")}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-press inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-[13px] font-semibold transition hover:border-black/30"
          >
            <DoodleIcon name="link" size={15} />
            View listing in REX
          </a>
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
  // Where the drawer should grow from — the centre of the tile clicked.
  const [zoom, setZoom] = useState<ZoomOrigin>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("default");

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

  // The slices the quick tabs and the Filter dropdown both drive.
  const daysTo = (iso: string | null) =>
    iso ? Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000) : null;
  const epcNeedsWork = (p: PortfolioProperty) =>
    p.items.some((i) => i.type.includes("epc") && i.state !== "valid" && i.state !== "not-required");
  const renewalSoon = (p: PortfolioProperty) => {
    const d = daysTo(p.nextRenewal?.expiry ?? null);
    return d != null && d <= 30;
  };
  const matches = (p: PortfolioProperty, key: string) => {
    if (key === "renewals") return p.outstanding > 0;
    if (key === "epc") return epcNeedsWork(p);
    // "No renewals on file" and "All clear" each state a fact about the whole
    // record, so each needs a complete answer — the tile already refuses to say
    // "No renewals on file" for a property REX cut us off on.
    if (key === "norenewal") return p.checked && !p.nextRenewal;
    if (key === "clear") return p.checked && p.items.length > 0 && p.outstanding === 0;
    if (key === "unchecked") return !p.checked;
    return true;
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = all.filter((p) => {
      if (!matches(p, filter)) return false;
      if (q && !`${p.name} ${p.locality} ${p.address}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sort === "rent") return [...list].sort((a, b) => (b.rent ?? 0) - (a.rent ?? 0));
    if (sort === "renewal")
      return [...list].sort((a, b) => {
        const x = a.nextRenewal?.expiry ?? "9999";
        const y = b.nextRenewal?.expiry ?? "9999";
        return x.localeCompare(y);
      });
    if (sort === "address") return [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, filter, search, sort]);

  const renewals30 = all.filter(renewalSoon).length;

  // Properties REX cut us off on, and everything computed over the ones it did
  // answer for. The rate used to fall back to 100% when nothing had items, so a
  // fetch where every chunk failed showed a green "100% compliance rate" over a
  // book nobody had checked — null now, rendered as "—".
  const unchecked = all.filter((p) => !p.checked);
  const checkedProps = all.filter((p) => p.checked);
  const clearCount = checkedProps.filter(
    (p) => p.items.length > 0 && p.outstanding === 0
  ).length;
  const noRenewalCount = checkedProps.filter((p) => !p.nextRenewal).length;
  const withItems = checkedProps.filter((p) => p.items.length > 0).length;
  const complianceRate = withItems ? Math.round((clearCount / withItems) * 100) : null;

  return (
    // Same outline treatment as the rest of the portal.
    <div className="outline-cards soft-cards space-y-6">
      <div className="enter enter-up" style={enterAt(60)}>
        <h1 className="tracking-tight" style={{ fontSize: "clamp(32px, 3.6vw, 46px)", lineHeight: 1.05, fontWeight: 500 }}>My Portfolio</h1>
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

      {/* A partial answer that looks complete is the one failure this page can't
          afford, so it leads with what's missing rather than burying it. */}
      {unchecked.length ? (
        <div className="card border-amber-200 bg-amber-50 p-4 text-[13px]">
          <span className="font-semibold text-amber-800">
            REX didn&apos;t finish answering for {unchecked.length}{" "}
            {unchecked.length === 1 ? "property" : "properties"}.
          </span>{" "}
          <span className="text-ink">
            They&apos;re marked &ldquo;couldn&apos;t check&rdquo; and left out of the
            compliance rate — treat them as unknown, not as clear.
          </span>
        </div>
      ) : null}

      {loading ? (
        <Loader label="Loading your portfolio…" />
      ) : linked && !error && all.length === 0 ? (
        <div className="card p-10 text-center text-[13px] text-muted">
          Nothing in your managed portfolio yet — properties land here once
          they&apos;re let and marked leased in REX.
        </div>
      ) : all.length > 0 ? (
        <>
          {/* Summary as bare text on the paper, filters on the right. */}
          <div
            className="enter enter-up flex min-h-[40px] flex-wrap items-center justify-between gap-3"
            style={enterAt(140)}
          >
            <p className="text-[13px] text-muted">
              <span className="font-semibold text-ink">
                {all.length} {all.length === 1 ? "property" : "properties"}
              </span>
              {rentRoll > 0 ? (
                <>
                  {" "}
                  · <span className="font-semibold text-ink">{money(rentRoll)}</span> rent roll a
                  month
                </>
              ) : null}
              {totalOutstanding > 0 ? (
                <>
                  {" "}
                  ·{" "}
                  <span className="font-semibold text-ink">
                    {totalOutstanding} {totalOutstanding === 1 ? "renewal" : "renewals"} due
                  </span>
                </>
              ) : null}
            </p>
            <FilterBar
              options={[
                { key: "all", label: "All properties" },
                { key: "renewals", label: "Renewals due" },
                { key: "epc", label: "Expiring EPC" },
                { key: "norenewal", label: "No renewals on file" },
                { key: "clear", label: "All clear" },
                { key: "unchecked", label: "Couldn't check" },
              ]}
              value={filter}
              onChange={setFilter}
              search={search}
              onSearch={setSearch}
            />
          </div>

          {/* ---- the overview bar ---- */}
          <div className="enter enter-up" style={enterAt(170)}>
            <StatStrip
              items={[
                { icon: "home", value: String(all.length), label: "Total properties" },
                { icon: "wallet", value: money(rentRoll) ?? "—", label: "Rent roll a month" },
                {
                  icon: "calendar",
                  value: String(renewals30),
                  label: "Renewals in 30 days",
                  dot: renewals30 > 0 ? "amber" : undefined,
                },
                { icon: "doc", value: money(rentRoll * 12) ?? "—", label: "Annual rental income" },
                {
                  icon: "shield",
                  value: complianceRate == null ? "—" : `${complianceRate}%`,
                  label: unchecked.length
                    ? `Compliance rate — ${unchecked.length} unchecked`
                    : "Compliance rate",
                  // No rate is not a bad rate: neutral ink, never red or green.
                  tone:
                    complianceRate == null ? "ink" : complianceRate >= 90 ? "green" : "red",
                },
              ]}
            />
          </div>

          {/* ---- quick cuts + sort ---- */}
          <div className="enter enter-up" style={enterAt(190)}>
            <QuickTabs
              tabs={[
                { key: "all", label: "All properties", count: all.length },
                { key: "renewals", label: "Renewals due", count: all.filter((p) => matches(p, "renewals")).length, dot: "amber" },
                { key: "epc", label: "Expiring EPC", count: all.filter(epcNeedsWork).length, dot: "red" },
                { key: "norenewal", label: "No renewals on file", count: noRenewalCount },
                { key: "clear", label: "All clear", count: clearCount, dot: "green" },
                ...(unchecked.length
                  ? [
                      {
                        key: "unchecked",
                        label: "Couldn't check",
                        count: unchecked.length,
                        dot: "amber" as const,
                      },
                    ]
                  : []),
              ]}
              value={filter}
              onChange={setFilter}
              sort={sort}
              onSort={setSort}
              sortOptions={[
                { key: "default", label: "Worst first" },
                { key: "renewal", label: "Renewal date" },
                { key: "rent", label: "Highest rent" },
                { key: "address", label: "Address A–Z" },
              ]}
            />
          </div>

          {shown.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-muted">
              Nothing matches — clear the filter or search.
            </p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 2xl:grid-cols-3">
              {shown.map((p, i) => (
                <PortfolioTile
                  key={p.listingId}
                  p={p}
                  delay={200 + i * 50}
                  onOpen={(o) => { setZoom(o); setOpen(p); }}
                />
              ))}
            </div>
          )}
        </>
      ) : null}

      {open ? <Drawer p={open} origin={zoom} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
