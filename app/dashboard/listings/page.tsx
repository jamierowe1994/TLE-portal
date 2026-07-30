"use client";

// My Properties — the agent's live REX listings.
//
// Progressive reveal: the tile carries only what you need to pick a property out
// of a list (status, name, address, rent, photo). Everything else — where the
// let is up to, what's outstanding, which platform does the next bit — lives
// behind the click, so the grid stays scannable.

import { useEffect, useRef, useState } from "react";
import Loader from "@/components/Loader";
import { formatGBP } from "@/lib/format";
import { platformById } from "@/lib/platforms";
import { rexListingUrl } from "@/lib/rex-links";
import SplitDrawer, { DrawerPanel } from "@/components/SplitDrawer";
import DrawerRail, { type RailAction } from "@/components/DrawerRail";
import DoodleIcon from "@/components/DoodleIcon";
import MilestoneBars, { type Milestone } from "@/components/charts/MilestoneBars";
import PhotoCarousel from "@/components/PhotoCarousel";
import NoPhoto from "@/components/NoPhoto";
import type { AgentListing } from "@/lib/rex-stats";
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

// One box: the photos run full-width across the top, then the property
// details on the left; the right-hand column is a live panel area driven by
// the action rail down the drawer's right edge.
type PanelId = "next" | "note" | "contacts" | "chat" | "details" | "files";

function milestonesFor(l: AgentListing, stage: Stage): { title: string; bars: Milestone[] } {
  const epc = epcState(l);
  const epcBar: Milestone = {
    label: "EPC in date",
    progress: epc.state === "valid" || epc.state === "not-required" ? 1 : epc.state === "expiring" ? 0.6 : 0,
    note: epc.label,
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
        },
        epcBar,
        { label: "Published to the portals", progress: 0, note: "Still a draft" },
      ],
    };
  }
  if (stage === "on-market") {
    return {
      title: "Finding a tenant",
      bars: [
        { label: "Live on the portals", progress: 1, note: l.publicationStatus ?? "Published" },
        epcBar,
        { label: "Let agreed", progress: 0.35, note: "On the market" },
      ],
    };
  }
  return {
    title: "Tenancy set-up",
    bars: [
      { label: "Let agreed", progress: 1, note: "Agreed" },
      epcBar,
      { label: "Deposit / flatbond", progress: 0, note: "Tracked once Flatfair is live" },
      { label: "Inventory booked", progress: 0, note: "Tracked once InventoryBase is live" },
      { label: "Rent collection", progress: 0, note: "Tracked once PayProp is live" },
    ],
  };
}

function Drawer({ l, onClose }: { l: AgentListing; onClose: () => void }) {
  const stage = stageOf(l);
  const epc = epcState(l);
  const steps = stepsFor(l, stage);
  const [panel, setPanel] = useState<PanelId>("next");
  // Switching panels is a two-beat move: the old one falls off the bottom,
  // then the new one bounces up into place.
  const [leaving, setLeaving] = useState(false);
  const switchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const switchPanel = (next: PanelId) => {
    const target = panel === next ? "next" : next;
    if (target === panel || leaving) return;
    setLeaving(true);
    if (switchTimer.current) clearTimeout(switchTimer.current);
    switchTimer.current = setTimeout(() => {
      setPanel(target);
      setLeaving(false);
    }, 290);
  };
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState<PropertyNote[] | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  // The just-saved note id — it gets the float-up entrance; the composer
  // folds down, then folds back out fresh.
  const [floating, setFloating] = useState<string | null>(null);
  const [folding, setFolding] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <SplitDrawer onClose={onClose} hideClose>
      <DrawerPanel
        className="relative shrink-0 grow-0 p-3"
        style={{ width: "min(56rem, calc(100vw - 2rem))" }}
      >
        <DrawerRail actions={actions} />

        <div className="overflow-hidden rounded-2xl">
          <PhotoCarousel images={l.images} alt={l.name} aspect="h-64 sm:h-80" />
        </div>

        <div className="grid gap-x-8 p-5 sm:p-6 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${STAGE_STYLE[stage]}`}>
            {STAGE_LABEL[stage]}
          </span>
          <h2 className="mt-3 text-[17px] font-semibold leading-snug">{l.name}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{l.locality}</p>

          <div className="mt-5 grid grid-cols-3 gap-3 border-y border-line py-5 text-[11px] text-muted">
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

          {/* Only the process the property is IN right now. */}
          {(() => {
            const proc = milestonesFor(l, stage);
            return (
              <div className="mt-6">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {proc.title}
                </h3>
                <div className="mt-3">
                  <MilestoneBars milestones={proc.bars} />
                </div>
              </div>
            );
          })()}

        </div>

        {/* ---- the active box: whatever the rail summons lands here, at the
             bottom, with a bounce; the outgoing panel falls off first ---- */}
        <div className="mt-6 flex min-h-[300px] flex-col justify-end overflow-hidden border-t border-line pt-5 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <div key={leaving ? `${panel}-out` : panel} className={leaving ? "panel-fall" : "panel-bounce"}>
          {panel === "next" ? (
            steps.length ? (
              <div key="next">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                  What&rsquo;s next
                </h3>
                <div className="mt-3 space-y-2.5">
                  {steps.map((s) => (
                    <StepRow key={s.title} s={s} />
                  ))}
                </div>
              </div>
            ) : (
              <ThumbsUp key="next" />
            )
          ) : null}

          {panel === "files" ? (
            <div key="files" className="flex h-full flex-col">
              <FilesPanel listing={l} />
            </div>
          ) : null}

          {panel === "note" ? (
            <div key="note" className="flex h-full flex-col">
              <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                <DoodleIcon name="note" size={15} />
                Notes on this property
              </h3>

              {/* the log — newest at the top, speech bubbles per side:
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
                    onClick={() => switchPanel("next")}
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
                <DoodleIcon name="call" size={15} />
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
                <DoodleIcon name="info" size={15} />
                More details
              </h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-line px-4 py-4 text-[12px]">
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
            </div>
          ) : null}
          </div>
        </div>
        </div>
      </DrawerPanel>
    </SplitDrawer>
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

/* ------------------------------- thumbs up -------------------------------- */

// Nothing outstanding → the thumbs-up clip plays big, and the speech bubble
// pops in over the final beat. The current export is H.264, which can't hold
// transparency — the tool baked its checkerboard preview into the pixels — so
// the clip is drawn through a canvas that keys the checker greys out on the
// fly. (A real WebM/VP9-alpha export can replace all of this.)
function ThumbsUp() {
  const [bubble, setBubble] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let raf = 0;
    const W = 256; // process at display size, not the source 720p
    const H = 455;
    canvas.width = W;
    canvas.height = H;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (video.readyState < 2) return;
      ctx.drawImage(video, 0, 0, W, H);
      const frame = ctx.getImageData(0, 0, W, H);
      const px = frame.data;
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        // The checkerboard is two near-neutral light greys (~200/~210).
        // The artwork's whites are ~250+, its ink near-black — both safe.
        if (r > 180 && r < 228 && Math.abs(r - g) < 8 && Math.abs(g - b) < 8) {
          px[i + 3] = 0;
        }
      }
      ctx.putImageData(frame, 0, 0);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex justify-center">
      <div className="relative inline-block">
        <video
          ref={videoRef}
          src="/illustrations/thumbs.mp4"
          muted
          autoPlay
          playsInline
          className="hidden"
          onTimeUpdate={(e) => {
            if (e.currentTarget.currentTime >= 7.2 && !bubble) setBubble(true);
          }}
          onEnded={(e) => {
            // Hold the final thumbs-up frame rather than going black.
            e.currentTarget.currentTime = Math.max(0, e.currentTarget.duration - 0.05);
          }}
        />
        <canvas ref={canvasRef} className="h-64 w-auto" aria-hidden />
        {/* lands on the clip's own drawn (empty) bubble, top-left */}
        {bubble ? (
          <div className="bubble-pop absolute -left-6 top-4 rounded-2xl rounded-br-sm border-2 border-ink bg-white px-3 py-1.5 shadow-sm">
            <p className="text-[12px] font-semibold text-ink">Nothing outstanding!</p>
          </div>
        ) : null}
      </div>
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
    // Same outline treatment as the dashboard — boxes as hairline outlines on
    // the grey, photos and property details inside.
    <div className="outline-cards space-y-6">
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
