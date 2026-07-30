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
type PanelId = "next" | "note" | "contacts" | "chat";

function milestonesFor(l: AgentListing, stage: Stage): Milestone[] {
  const epc = epcState(l);
  const hasPhotos = l.imageCount > 0;
  const published = l.publicationStatus?.toLowerCase() !== "draft";
  const agreed = stage === "let-agreed";
  return [
    {
      label: "Photos on file",
      progress: hasPhotos ? 1 : 0,
      note: hasPhotos ? `${l.imageCount} uploaded` : "None yet",
    },
    {
      label: "EPC in date",
      progress: epc.state === "valid" ? 1 : epc.state === "not-required" ? 1 : epc.state === "expiring" ? 0.6 : 0,
      note: epc.label,
    },
    {
      label: "Live on the portals",
      progress: published ? 1 : 0,
      note: published ? (l.publicationStatus ?? "Published") : "Still a draft",
    },
    {
      label: "Let agreed",
      progress: agreed ? 1 : published ? 0.35 : 0,
      note: agreed ? "Agreed" : published ? "On the market" : "Not yet live",
    },
    {
      label: "Tenancy set up",
      progress: agreed ? 0.5 : 0,
      note: agreed ? "In progress" : "Waiting on a let",
    },
  ];
}

function Drawer({ l, onClose }: { l: AgentListing; onClose: () => void }) {
  const stage = stageOf(l);
  const epc = epcState(l);
  const steps = stepsFor(l, stage);
  const [panel, setPanel] = useState<PanelId>("next");
  const [showDetails, setShowDetails] = useState(false);
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const actions: RailAction[] = [
    { id: "close", icon: "cross", label: "Close", onClick: onClose, top: true },
    {
      id: "note",
      icon: "note",
      label: "Add a note",
      active: panel === "note",
      onClick: () => setPanel((p) => (p === "note" ? "next" : "note")),
    },
    {
      id: "contacts",
      icon: "call",
      label: "Contact details",
      active: panel === "contacts",
      onClick: () => setPanel((p) => (p === "contacts" ? "next" : "contacts")),
    },
    {
      id: "chat",
      icon: "message-2",
      label: "Ask a question",
      active: panel === "chat",
      onClick: () => setPanel((p) => (p === "chat" ? "next" : "chat")),
    },
    {
      id: "details",
      icon: "info",
      label: showDetails ? "Hide details" : "More details",
      active: showDetails,
      onClick: () => setShowDetails((v) => !v),
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
    // Notes ride on the agent's own to-do list so they surface in the places
    // that already read it (the list itself and the assistant).
    await fetch("/api/my/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: text, property: l.name, platform: "REX" }),
    }).catch(() => {});
    setSavedNote(text);
    setNote("");
    setSaving(false);
    setPanel("next");
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

          {/* Where this property is up to, drawn as filling bars. */}
          <div className="mt-6">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Where it&rsquo;s up to
            </h3>
            <div className="mt-3">
              <MilestoneBars milestones={milestonesFor(l, stage)} />
            </div>
          </div>

          {/* The long tail — toggled from the rail rather than a dropdown. */}
          {showDetails ? (
            <dl className="panel-up mt-5 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-line px-4 py-4 text-[12px]">
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
          ) : null}
        </div>

        {/* ---- the active panel: whatever the rail last asked for ---- */}
        <div className="mt-6 min-h-[280px] border-t border-line pt-5 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          {panel === "next" ? (
            <div key="next" className="panel-up">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                {steps.length ? "What's next" : "Nothing outstanding"}
              </h3>
              {steps.length ? (
                <div className="mt-3 space-y-2.5">
                  {steps.map((s) => (
                    <StepRow key={s.title} s={s} />
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[13px] text-muted">
                  Nothing needs doing on this one right now.
                </p>
              )}
              {savedNote ? (
                <div className="mt-4 rounded-xl border border-line p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Note added
                  </p>
                  <p className="mt-1 text-[12px] text-ink">{savedNote}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {panel === "note" ? (
            <div key="note" className="panel-up flex h-full flex-col">
              <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                <DoodleIcon name="note" size={15} />
                Add a note
              </h3>
              <textarea
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={`Something to remember about ${l.name}…`}
                className="mt-3 h-32 w-full resize-none rounded-xl border border-line bg-white p-3 text-[13px] outline-none transition focus:border-black/25"
              />
              <div className="mt-3 flex gap-2">
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
                  onClick={() => setPanel("next")}
                  className="btn-press rounded-full border border-line px-4 py-2 text-[12px] font-medium text-muted transition hover:text-ink"
                >
                  Cancel
                </button>
              </div>
              <p className="mt-3 text-[11px] text-muted">
                Saved to your to-do list against this property, so the assistant
                can find it too.
              </p>
            </div>
          ) : null}

          {panel === "contacts" ? (
            <div key="contacts" className="panel-up">
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
            <div key="chat" className="panel-up">
              <PropertyChat listing={l} />
            </div>
          ) : null}
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
