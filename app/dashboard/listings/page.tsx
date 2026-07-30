"use client";

// My Properties — the agent's live REX listings.
//
// Progressive reveal: the tile carries only what you need to pick a property out
// of a list (status, name, address, rent, photo). Everything else — where the
// let is up to, what's outstanding, which platform does the next bit — lives
// behind the click, so the grid stays scannable.

import { useEffect, useMemo, useRef, useState } from "react";
import Loader from "@/components/Loader";
import { formatGBP } from "@/lib/format";
import { platformById } from "@/lib/platforms";
import { rexListingUrl } from "@/lib/rex-links";
import SplitDrawer, { DrawerPanel } from "@/components/SplitDrawer";
import DrawerRail, { type RailAction } from "@/components/DrawerRail";
import DoodleIcon from "@/components/DoodleIcon";
import SkewProgress, { type SkewStep } from "@/components/charts/SkewProgress";
import FilterBar from "@/components/FilterBar";
import PhotoCarousel from "@/components/PhotoCarousel";
import NoPhoto from "@/components/NoPhoto";
import type { AgentListing, ListingDetail } from "@/lib/rex-stats";
import type { PropertyNote } from "@/lib/property-notes-store";

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
    return <NoPhoto className={rounded} />;
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
        <div className={`relative h-full w-full overflow-hidden rounded-xl ${l.image ? "bg-page" : ""}`}>
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

// One box: the photos run full-width across the top, then the property
// details on the left; the right-hand column is a live panel area driven by
// the action rail down the drawer's right edge.
type PanelId = "activity" | "note" | "contacts" | "chat" | "details" | "files";

function milestonesFor(l: AgentListing, stage: Stage): { title: string; bars: SkewStep[] } {
  const epc = epcState(l);
  const epcBar: SkewStep = {
    label: "EPC in date",
    progress: epc.state === "valid" || epc.state === "not-required" ? 1 : epc.state === "expiring" ? 0.6 : 0,
    note: epc.label,
    icon: "shield",
  };

  // Only the process the property is actually IN — the bars change as it
  // moves through draft → market → tenancy set-up.
  if (stage === "draft") {
    return {
      title: "Getting it to market",
      bars: [
        {
          label: "Photos on file",
          progress: l.imageCount > 0 ? 1 : 0,
          note: l.imageCount > 0 ? `${l.imageCount} uploaded` : "None yet",
          icon: "grid",
        },
        epcBar,
        { label: "Published to the portals", progress: 0, note: "Still a draft", icon: "megaphone" },
      ],
    };
  }
  if (stage === "on-market") {
    return {
      title: "Finding a tenant",
      bars: [
        { label: "Live on the portals", progress: 1, note: l.publicationStatus ?? "Published", icon: "megaphone" },
        epcBar,
        { label: "Let agreed", progress: 0.35, note: "On the market", icon: "key" },
      ],
    };
  }
  return {
    title: "Tenancy set-up",
    bars: [
      { label: "Let agreed", progress: 1, note: "Agreed", icon: "key" },
      epcBar,
      { label: "Deposit / flatbond", progress: 0, note: "Tracked once Flatfair is live", icon: "wallet" },
      { label: "Inventory booked", progress: 0, note: "Tracked once InventoryBase is live", icon: "checklist" },
      { label: "Rent collection", progress: 0, note: "Tracked once PayProp is live", icon: "coin" },
    ],
  };
}

function Drawer({ l, onClose }: { l: AgentListing; onClose: () => void }) {
  const stage = stageOf(l);
  const epc = epcState(l);
  const [panel, setPanel] = useState<PanelId>("activity");
  // Switching panels is a two-beat move: the old one falls off the bottom,
  // then the new one bounces up into place.
  const [leaving, setLeaving] = useState(false);
  const switchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const switchPanel = (next: PanelId) => {
    const target = panel === next ? "activity" : next;
    if (target === panel || leaving) return;
    setLeaving(true);
    if (switchTimer.current) clearTimeout(switchTimer.current);
    switchTimer.current = setTimeout(() => {
      setPanel(target);
      setLeaving(false);
    }, 290);
  };
  // undefined = still loading, null = REX wouldn't answer
  const [detail, setDetail] = useState<ListingDetail | null | undefined>(undefined);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState<PropertyNote[] | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  // The just-saved note id — it gets the float-up entrance; the composer
  // folds down, then folds back out fresh.
  const [floating, setFloating] = useState<string | null>(null);
  const [folding, setFolding] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  // The advert copy, room counts and dated history — one call on open.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/my/listing-detail?id=${encodeURIComponent(l.id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { detail?: ListingDetail }) => {
        if (!cancelled) setDetail(d.detail ?? null);
      })
      .catch(() => !cancelled && setDetail(null));
    return () => {
      cancelled = true;
    };
  }, [l.id]);

  // Pull the thread the first time the note panel opens.
  useEffect(() => {
    if (panel !== "note" || notes !== null) return;
    fetch(`/api/my/property-notes?listingId=${encodeURIComponent(l.id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { notes?: PropertyNote[]; me?: string }) => {
        setNotes(d.notes ?? []);
        setMeId(d.me ?? null);
      })
      .catch(() => setNotes([]));
  }, [panel, notes, l.id]);

  // The thread reads top-down; new notes join at the bottom and push the
  // older ones up, so keep the view pinned to the newest.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [notes, panel]);

  const actions: RailAction[] = [
    { id: "close", icon: "cross", label: "Close", onClick: onClose, top: true },
    {
      id: "activity",
      icon: "clock",
      label: "Activity",
      active: panel === "activity",
      onClick: () => switchPanel("activity"),
    },
    {
      id: "note",
      icon: "note",
      label: "Add a note",
      active: panel === "note",
      onClick: () => switchPanel("note"),
    },
    {
      id: "contacts",
      icon: "call",
      label: "Contact details",
      active: panel === "contacts",
      onClick: () => switchPanel("contacts"),
    },
    {
      id: "chat",
      icon: "message-2",
      label: "Ask a question",
      active: panel === "chat",
      onClick: () => switchPanel("chat"),
    },
    {
      id: "files",
      icon: "upload",
      label: "Add a file",
      active: panel === "files",
      onClick: () => switchPanel("files"),
    },
    {
      id: "email",
      icon: "mail",
      label: "Send an email",
      onClick: () => {
        window.location.href = `mailto:?subject=${encodeURIComponent(`${l.name}, ${l.locality}`)}`;
      },
    },
    {
      id: "details",
      icon: "info",
      label: "More details",
      active: panel === "details",
      onClick: () => switchPanel("details"),
    },
    {
      id: "rex",
      icon: "link",
      label: "View listing in REX",
      onClick: () => window.open(rexListingUrl(l.id, "rental"), "_blank", "noopener"),
    },
  ];

  async function saveNote() {
    const text = note.trim();
    if (!text || saving) return;
    setSaving(true);
    setFolding(true); // composer folds down around the note…
    try {
      // Let the fold play in full even when the API answers instantly —
      // the choreography is the point.
      const [res] = await Promise.all([
        fetch("/api/my/property-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId: l.id, text }),
        }),
        new Promise((r) => setTimeout(r, 380)),
      ]);
      const data = (await res.json()) as { note?: PropertyNote };
      if (res.ok && data.note) {
        // …then the note floats up into the top of the log…
        setNotes((prev) => [...(prev ?? []), data.note!]);
        setFloating(data.note.id);
        setNote("");
      }
    } catch {
      /* keep the text so nothing is lost */
    } finally {
      setSaving(false);
      // …and a fresh composer folds back out underneath.
      setTimeout(() => setFolding(false), 80);
      setTimeout(() => setFloating(null), 900);
    }
  }

  const facts = [
    { key: "bed", label: "Bedrooms", value: detail?.bedrooms },
    { key: "bath", label: "Bathrooms", value: detail?.bathrooms },
    { key: "sofa", label: "Receptions", value: detail?.receptions },
  ].filter((f) => f.value != null && f.value > 0);

  const keyDetails: Array<[string, string]> = [
    ["Property type", detail?.propertyType ?? l.category ?? "—"],
    ["Furnishing", detail?.furnishing ?? l.letType ?? "—"],
    ["Council tax band", detail?.councilTaxBand ?? "—"],
    ["Deposit", detail?.deposit != null ? formatGBP(detail.deposit) : "—"],
    ["Minimum term", l.minTermMonths ? `${l.minTermMonths} months` : "—"],
    ["Availability", fmtDate(l.availableFrom) ?? "—"],
  ];

  return (
    <SplitDrawer onClose={onClose} hideClose>
      <DrawerPanel
        className="relative shrink-0 grow-0 p-5 sm:p-7"
        style={{ width: "min(66rem, calc(100vw - 2rem))" }}
      >
        <DrawerRail actions={actions} />

        {/* ---- top: the photos on the left, the headline facts on the right ---- */}
        <div className="grid gap-7 lg:grid-cols-[1.05fr_1fr] lg:gap-9">
          <div className="relative min-w-0">
            <PhotoCarousel
              images={l.images}
              alt={l.name}
              aspect="h-64 sm:h-[19rem]"
              arrowsOutside
              thumbs
            />
            <span
              className={`pointer-events-none absolute left-12 top-3 rounded-full border px-2.5 py-1 text-[9px] font-semibold ${STAGE_STYLE[stage]}`}
            >
              {STAGE_LABEL[stage]}
            </span>
          </div>

          <div className="min-w-0">
            <h2 className="text-[26px] leading-tight tracking-tight" style={{ fontWeight: 500 }}>
              {l.name}
            </h2>
            <p className="mt-1.5 text-[14px] text-muted">{l.locality}</p>

            <div className="mt-5 border-t border-line pt-5">
              <div className="flex items-end gap-2">
                <span className="stat-value text-[34px] leading-none" style={{ fontWeight: 300 }}>
                  {l.rent != null ? formatGBP(l.rent) : "—"}
                </span>
                <span className="pb-1 text-[13px] text-muted">
                  / {(l.rentPeriod ?? "month").toLowerCase()}
                </span>
              </div>
              <p className="mt-2.5 text-[12.5px] text-muted">
                Available from <span className="text-ink">{fmtDate(l.availableFrom) ?? "—"}</span>
                {"  ·  "}
                Minimum term{" "}
                <span className="text-ink">{l.minTermMonths ? `${l.minTermMonths} months` : "—"}</span>
              </p>

              {/* Compliance — only shouts when it needs to */}
              <div className="mt-3 flex items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${epcNeedsWork(epc.state) ? "bg-amber-500" : "bg-emerald-500"}`}
                />
                <span className="text-[12.5px] text-muted">{epc.label}</span>
                {l.epcRating != null ? (
                  <span className="text-[12.5px] text-muted">· Rating {l.epcRating}</span>
                ) : null}
              </div>
            </div>

            {/* room counts, straight from the REX property record */}
            {facts.length ? (
              <div className="mt-5 grid grid-cols-3 gap-3">
                {facts.map((f) => (
                  <div
                    key={f.key}
                    className="flex flex-col items-center gap-1 rounded-2xl border border-line px-2 py-4"
                  >
                    <RoomIcon name={f.key} />
                    <span className="stat-value text-[19px] leading-none" style={{ fontWeight: 400 }}>
                      {f.value}
                    </span>
                    <span className="text-[11px] text-muted">{f.label}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Only the process the property is IN right now. */}
            {(() => {
              const proc = milestonesFor(l, stage);
              return (
                <div className="mt-6">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {proc.title}
                  </h3>
                  <div className="mt-3">
                    <SkewProgress steps={proc.bars} />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* ---- the write-up and the facts table, one box split down the middle ---- */}
        <div className="card mt-6 grid lg:grid-cols-[1.15fr_1fr]">
          <div className="min-w-0 p-5 sm:p-6">
            <h3 className="text-[15px]" style={{ fontWeight: 500 }}>About this property</h3>
            {detail === undefined ? (
              <p className="mt-3 text-[13px] text-muted">Loading the details…</p>
            ) : detail?.description ? (
              <>
                <div
                  className={`mt-3 space-y-2.5 text-[13px] leading-relaxed text-muted ${
                    aboutOpen ? "" : "line-clamp-6"
                  }`}
                >
                  {detail.description
                    .split(/\n{2,}/)
                    .filter((p) => p.trim())
                    .map((para, i) => (
                      <p key={i}>{para.trim()}</p>
                    ))}
                </div>
                <button
                  type="button"
                  onClick={() => setAboutOpen((v) => !v)}
                  className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted transition hover:text-ink"
                >
                  {aboutOpen ? "Show less" : "Show more"}
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ transform: aboutOpen ? "rotate(180deg)" : "none" }}
                  >
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </button>
              </>
            ) : (
              <p className="mt-3 text-[13px] text-muted">
                No advert copy on the REX record yet — add it there and it appears here.
              </p>
            )}
          </div>

          <div className="min-w-0 border-t border-line p-5 sm:p-6 lg:border-l lg:border-t-0">
            <h3 className="text-[15px]" style={{ fontWeight: 500 }}>Key details</h3>
            <dl className="mt-3.5 space-y-2.5">
              {keyDetails.map(([label, value]) => (
                <div key={label} className="flex items-baseline gap-2 text-[12.5px]">
                  <dt className="shrink-0 text-muted">{label}</dt>
                  {/* dotted leader, like a printed particulars sheet */}
                  <span className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-black/25" />
                  <dd className="shrink-0 text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* ---- the active box: activity lives here until the rail summons
             something else, which drops in over the top ---- */}
        <div className="card mt-6 flex min-h-[168px] flex-col justify-end overflow-hidden p-5 sm:p-6">
          <div key={leaving ? `${panel}-out` : panel} className={leaving ? "panel-fall" : "panel-bounce"}>
          {panel === "activity" ? (
            <div key="activity">
              <h3 className="text-[15px]" style={{ fontWeight: 500 }}>Activity</h3>
              <ActivityStrip detail={detail} />
            </div>
          ) : null}

          {panel === "files" ? (
            <div key="files" className="flex h-full flex-col">
              <FilesPanel listing={l} />
            </div>
          ) : null}

          {panel === "note" ? (
            <div key="note" className="flex h-full flex-col">
              <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                <DoodleIcon name="note" size={15} className="text-accent" />
                Notes on this property
              </h3>

              {/* the log — oldest at the top, speech bubbles per side:
                  yours on the left (outline only), the team's on the right */}
              <div ref={logRef} className="no-scrollbar mt-3 max-h-44 flex-1 space-y-2 overflow-y-auto pr-1">
                {notes === null ? (
                  <p className="text-[12px] text-muted">Loading the thread…</p>
                ) : notes.length === 0 ? (
                  <p className="text-[12px] text-muted">
                    Nothing on file yet — the first note starts the thread.
                  </p>
                ) : (
                  notes.map((n) => {
                    const mine = n.authorRole !== "team";
                    return (
                      <div
                        key={n.id}
                        className={`flex ${mine ? "justify-start" : "justify-end"} ${
                          floating === n.id ? "note-feather" : ""
                        }`}
                      >
                        <div
                          className={`max-w-[88%] rounded-2xl border px-3 py-2 text-[12px] leading-relaxed ${
                            mine
                              ? "rounded-bl-md border-ink/40 bg-transparent text-ink"
                              : "rounded-br-md border-line bg-black/[0.04] text-ink"
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{n.text}</p>
                          <p className="mt-1 text-[9.5px] uppercase tracking-wide text-muted">
                            {mine && n.authorId === meId ? "You" : n.authorName}
                            {" · "}
                            {new Date(n.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* the composer — folds down on save, folds back out fresh */}
              <div className={folding ? "note-fold" : floating ? "note-unfold" : ""}>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={`Add a note about ${l.name}…`}
                  className="mt-3 h-20 w-full resize-none rounded-xl border border-line bg-white p-3 text-[13px] outline-none transition focus:border-black/25"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void saveNote()}
                    disabled={!note.trim() || saving}
                    className="btn-press rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-white transition disabled:opacity-40"
                  >
                    {saving ? "Saving…" : "Save note"}
                  </button>
                  <button
                    type="button"
                    onClick={() => switchPanel("activity")}
                    className="btn-press rounded-full border border-line px-4 py-2 text-[12px] font-medium text-muted transition hover:text-ink"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {panel === "contacts" ? (
            <div key="contacts">
              <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                <DoodleIcon name="call" size={15} className="text-accent" />
                Contact details
              </h3>
              <div className="mt-3 space-y-2">
                <div className="rounded-xl border border-line p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Property</p>
                  <p className="mt-1 text-[13px] text-ink">{l.address}</p>
                </div>
                <p className="text-[12px] text-muted">
                  Landlord and tenant contacts live on the REX record — open it
                  from the rail and they&rsquo;re on the contacts tab.
                </p>
                <a
                  href={rexListingUrl(l.id, "rental")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-press inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12px] font-semibold transition hover:border-black/25"
                >
                  Open contacts in REX
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 17L17 7M9 7h8v8" />
                  </svg>
                </a>
              </div>
            </div>
          ) : null}

          {panel === "chat" ? (
            <div key="chat">
              <PropertyChat listing={l} />
            </div>
          ) : null}

          {panel === "details" ? (
            <div key="details">
              <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                <DoodleIcon name="info" size={15} className="text-accent" />
                More details
              </h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-line px-4 py-4 text-[12px] sm:grid-cols-3">
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
              {l.category ? (
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">Category</dt>
                  <dd className="mt-0.5 font-medium">{l.category}</dd>
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
            </div>
          ) : null}
          </div>
        </div>
      </DrawerPanel>
    </SplitDrawer>
  );
}

/* ------------------------------ room icons -------------------------------- */

// Bed, bath and sofa in the same hand-drawn stroke as the doodle set — the
// pack has no room glyphs, so these are drawn to match rather than imported.
function RoomIcon({ name }: { name: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-6 w-6 text-ink",
    "aria-hidden": true,
  };
  if (name === "bed") {
    return (
      <svg {...common}>
        <path d="M3 18v-7.5c0-.6.5-1 1-1h16c.6 0 1 .4 1 1V18" />
        <path d="M3 15h18M3 18h18M6.5 9.5V7.2c0-.6.5-1 1-1h9c.6 0 1 .4 1 1v2.3" />
        <path d="M8 12.6h3M13 12.6h3" />
      </svg>
    );
  }
  if (name === "bath") {
    return (
      <svg {...common}>
        <path d="M3.5 12h17v2.2a4.3 4.3 0 0 1-4.3 4.3H7.8A4.3 4.3 0 0 1 3.5 14.2z" />
        <path d="M6 12V6.6a1.9 1.9 0 0 1 3.5-1" />
        <path d="M7.5 19.4 6.6 21M16.5 19.4l.9 1.6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 17v-5.4A2.6 2.6 0 0 1 6.6 9h10.8A2.6 2.6 0 0 1 20 11.6V17" />
      <path d="M4 13.4A1.7 1.7 0 0 0 2.6 15v2.4h18.8V15A1.7 1.7 0 0 0 20 13.4" />
      <path d="M6.5 17.4V19M17.5 17.4V19M8.5 9V7.4h7V9" />
    </svg>
  );
}

/* ----------------------------- activity strip ----------------------------- */

// The property's dated milestones across the bottom of the drawer: circled
// hand-drawn marks joined by a dotted run, oldest on the left.
function ActivityStrip({ detail }: { detail: ListingDetail | null | undefined }) {
  if (detail === undefined) {
    return <p className="mt-3 text-[13px] text-muted">Loading the history…</p>;
  }
  if (!detail?.activity.length) {
    return <p className="mt-3 text-[13px] text-muted">Nothing dated on this record yet.</p>;
  }
  const ICONS: Record<string, string> = {
    "Added to portfolio": "star",
    "Marked on market": "megaphone",
    "Available from": "key",
    "Details updated": "pencil",
    "Photos updated": "grid",
    "Price updated": "coin",
  };
  return (
    <div className="no-scrollbar mt-4 flex items-center gap-1 overflow-x-auto pb-1">
      {detail.activity.map((e, i) => (
        <div key={`${e.label}-${i}`} className="flex min-w-0 shrink-0 items-center gap-1">
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line">
              <DoodleIcon name={ICONS[e.label] ?? "info"} size={16} className="text-ink" />
            </span>
            <span className="min-w-0">
              <span className="block whitespace-nowrap text-[12.5px] text-ink">{e.label}</span>
              <span className="block whitespace-nowrap text-[11.5px] text-muted">{fmtDate(e.at) ?? "—"}</span>
            </span>
          </div>
          {i < detail.activity.length - 1 ? (
            <span className="mx-3 hidden h-px w-10 shrink-0 border-b border-dotted border-black/30 sm:block xl:w-16" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ property chat ----------------------------- */

/** Ask the assistant about this specific property, in the drawer. */
function PropertyChat({ listing }: { listing: AgentListing }) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const thread = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const q = input.trim();
    if (!q || streaming) return;
    setInput("");
    const history = [
      ...messages,
      {
        role: "user" as const,
        content: `About ${listing.address} (REX listing ${listing.id}): ${q}`,
      },
    ];
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);
    try {
      const res = await fetch("/api/my/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok || !res.body) {
        setMessages([...history, { role: "assistant", content: "Couldn't answer that just now." }]);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += dec.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: answer }]);
      }
    } catch {
      setMessages([...history, { role: "assistant", content: "Lost the connection — try again." }]);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
        <DoodleIcon name="message-2" size={15} />
        Ask about this property
      </h3>
      <div
        ref={thread}
        className="no-scrollbar mt-3 h-44 space-y-2.5 overflow-y-auto pr-1"
      >
        {messages.length === 0 ? (
          <p className="text-[12px] text-muted">
            &ldquo;When does the EPC expire?&rdquo; · &ldquo;What&rsquo;s outstanding here?&rdquo;
          </p>
        ) : (
          messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <span className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3 py-1.5 text-[12px] text-white">
                  {m.content.replace(/^About .*?\): /, "")}
                </span>
              </div>
            ) : (
              <div key={i} className="flex">
                <span className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-tl-md bg-black/[0.04] px-3 py-1.5 text-[12px] leading-relaxed text-ink">
                  {m.content || "…"}
                </span>
              </div>
            )
          )
        )}
      </div>
      <form
        className="relative mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          disabled={streaming}
          className="w-full rounded-full border border-line bg-white py-2 pl-3.5 pr-10 text-[12.5px] outline-none transition focus:border-black/25 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          aria-label="Send"
          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-white transition disabled:opacity-30"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  );
}

/* -------------------------------- files ---------------------------------- */

interface PropertyFileMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  uploaderName: string;
  createdAt: string;
}

const fmtSize = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`;

// The whole panel is the drop zone: a big dashed sketch of a box you can drop
// anything on (or click to browse). Uploads land in the list underneath.
function FilesPanel({ listing }: { listing: AgentListing }) {
  const [files, setFiles] = useState<PropertyFileMeta[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch(`/api/my/property-files?listingId=${encodeURIComponent(listing.id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { files?: PropertyFileMeta[] }) => setFiles(d.files ?? []))
      .catch(() => setFiles([]));
  }, [listing.id]);

  async function upload(list: FileList | File[]) {
    setProblem(null);
    for (const file of Array.from(list)) {
      setBusy(true);
      const form = new FormData();
      form.append("listingId", listing.id);
      form.append("file", file);
      try {
        const res = await fetch("/api/my/property-files", { method: "POST", body: form });
        const data = (await res.json()) as { file?: PropertyFileMeta; error?: string };
        if (res.ok && data.file) {
          setFiles((prev) => [data.file!, ...(prev ?? [])]);
        } else {
          setProblem(data.error ?? `Couldn't upload ${file.name}.`);
        }
      } catch {
        setProblem(`Couldn't upload ${file.name}.`);
      }
    }
    setBusy(false);
  }

  return (
    <div className="flex h-full flex-col">
      <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
        <DoodleIcon name="upload" size={15} />
        Files
      </h3>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
        }}
        className={`mt-3 flex min-h-[120px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed p-4 text-center transition ${
          dragging ? "border-ink bg-black/[0.04]" : "border-black/25 hover:border-ink/50"
        }`}
      >
        <DoodleIcon name="upload" size={26} className="text-muted" />
        <p className="text-[12.5px] font-medium text-ink">
          {busy ? "Uploading…" : "Drop a file here"}
        </p>
        <p className="text-[11px] text-muted">or click to choose one — photos, PDFs, anything</p>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = "";
        }}
      />
      {problem ? <p className="mt-2 text-[11px] text-red-600">{problem}</p> : null}

      <div className="no-scrollbar mt-3 max-h-32 space-y-1.5 overflow-y-auto">
        {files === null ? (
          <p className="text-[12px] text-muted">Loading files…</p>
        ) : files.length === 0 ? null : (
          files.map((f) => (
            <a
              key={f.id}
              href={`/api/my/property-files/${f.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2 transition hover:border-black/25"
            >
              <DoodleIcon name="doc" size={16} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-ink">{f.name}</span>
                <span className="block text-[10px] text-muted">
                  {fmtSize(f.size)} · {f.uploaderName}
                </span>
              </span>
            </a>
          ))
        )}
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
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

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

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((l) => {
      const stage = stageOf(l);
      if (filter === "draft" && stage !== "draft") return false;
      if (filter === "on-market" && stage !== "on-market") return false;
      if (filter === "let-agreed" && stage !== "let-agreed") return false;
      if (filter === "attention" && stepsFor(l, stage).length === 0) return false;
      if (q && !`${l.name} ${l.locality}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, filter, search]);

  return (
    // Same outline treatment as the dashboard — boxes as hairline outlines on
    // the grey, photos and property details inside.
    <div className="outline-cards soft-cards space-y-6">
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
        <Loader label="Loading your properties…" />
      ) : linked && !error && all.length === 0 ? (
        <div className="card p-10 text-center text-[13px] text-muted">
          Nothing on the market at the moment.
        </div>
      ) : all.length > 0 ? (
        <>
          <div
            className="enter enter-up flex min-h-[40px] flex-wrap items-center justify-between gap-3"
            style={enterAt(140)}
          >
            <p className="text-[13px] text-muted">
              {needs > 0 ? (
                <>
                  <span className="font-semibold text-ink">
                    {needs} {needs === 1 ? "property has" : "properties have"} something outstanding
                  </span>{" "}
                  — tap through to see what.
                </>
              ) : null}
            </p>
            <FilterBar
              options={[
                { key: "all", label: "All properties" },
                { key: "attention", label: "Something outstanding" },
                { key: "draft", label: "Draft" },
                { key: "on-market", label: "On the market" },
                { key: "let-agreed", label: "Let agreed" },
              ]}
              value={filter}
              onChange={setFilter}
              search={search}
              onSearch={setSearch}
            />
          </div>

          {shown.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-muted">
              Nothing matches — clear the filter or search.
            </p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 2xl:grid-cols-3">
              {shown.map((l, i) => (
                <ListingTile key={l.id} l={l} delay={200 + i * 50} onOpen={() => setOpen(l)} />
              ))}
            </div>
          )}
        </>
      ) : null}

      {open ? <Drawer l={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
