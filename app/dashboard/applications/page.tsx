"use client";

// Applications — the agent's live let pipeline, from REX tenancy applications.
//
// Same tile → click → detail shape as My Properties and Compliance. Progressive
// reveal twice over: unsuccessful applications are hidden until asked for (they
// outnumber the live ones and drown the pipeline), and the applicant detail only
// appears on the click.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DoodleIcon from "@/components/DoodleIcon";
import FilterBar from "@/components/FilterBar";
import StatStrip from "@/components/StatStrip";
import QuickTabs from "@/components/QuickTabs";
import Loader from "@/components/Loader";
import { formatGBP } from "@/lib/format";
import { BRAND } from "@/lib/brand";
import { DealNotesPanel } from "@/components/DealNotes";
import NoPhoto from "@/components/NoPhoto";
import SplitDrawer, { DrawerPanel } from "@/components/SplitDrawer";
import PhotoCarousel from "@/components/PhotoCarousel";
import { CHECKLIST_ITEMS, PORTAL_STAGES, PROPOLY_APP_URL } from "@/lib/propoly-stages";
import type { AgentApplication, ApplicationStage } from "@/lib/rex-stats";
import type { DealMeta } from "@/lib/types";

const enterAt = (ms: number) =>
  ({ "--enter-delay": `${ms}ms` }) as React.CSSProperties;

const STAGE_STYLE: Record<ApplicationStage, string> = {
  received: "border-line bg-page text-muted",
  communicated: "border-sky-200 bg-sky-50 text-sky-700",
  accepted: "border-green-200 bg-green-50 text-green-700",
  unsuccessful: "border-line bg-page text-muted",
};

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/* -------------------------------- photo -------------------------------- */

function Photo({ a }: { a: AgentApplication }) {
  if (!a.image) {
    return <NoPhoto />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={a.image} alt={a.propertyName} loading="lazy" className="h-full w-full object-cover" />;
}

/* --------------------------------- tile --------------------------------- */

function ApplicationTile({
  a,
  delay,
  onOpen,
}: {
  a: AgentApplication;
  delay: number;
  onOpen: () => void;
}) {
  const lead = a.tenants.find((t) => t.isPrimary) ?? a.tenants[0];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="enter enter-up card btn-press flex min-h-[210px] text-left transition hover:border-black/20"
      style={enterAt(delay)}
    >
      <div className="flex min-w-0 flex-1 flex-col p-6">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`w-fit rounded-full border px-2 py-0.5 text-[9px] font-semibold ${STAGE_STYLE[a.stage]}`}>
            {a.status.toUpperCase()}
          </span>
          {a.portal && a.portal.notesCount > 0 ? (
            <span className="flex items-center gap-1 rounded-full border border-line bg-page px-2 py-0.5 text-[9px] font-semibold text-muted">
              <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {a.portal.notesCount}
            </span>
          ) : null}
        </div>

        <h3 className="mt-3.5 truncate text-[14px] font-semibold leading-snug">
          {a.propertyName}
        </h3>
        <p className="mt-0.5 truncate text-[12px] text-muted">{a.locality}</p>

        <p className="mt-2 truncate text-[12px] text-muted">
          {lead ? lead.name : "No applicant recorded"}
          {a.tenants.length > 1 ? ` +${a.tenants.length - 1}` : ""}
        </p>

        <div className="mt-auto flex items-baseline gap-1 pt-4">
          <span className="stat-value text-[21px]">
            {a.offer != null ? formatGBP(a.offer) : "—"}
          </span>
          <span className="text-[11px] text-muted">
            {a.propoly ? "rent" : "offered"} /{" "}
            {(a.offerPeriod ?? "month").replace(/^Per /i, "").toLowerCase()}
          </span>
        </div>
      </div>

      <div className="w-[38%] shrink-0 p-3 pl-0">
        <div className="relative h-full w-full overflow-hidden rounded-xl bg-page">
          <Photo a={a} />
        </div>
      </div>
    </button>
  );
}

/* --------------------------- progression board --------------------------- */
// Stage definitions live in lib/propoly-stages.ts, shared with the
// pre-tenancy dashboard so both sides always show the same board.

/* ---------------------- pieces of the Propoly drawer ---------------------- */

/** A stat in the drawer header: icon, figure, label. */
function HeadStat({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <DoodleIcon name={icon} size={22} className="shrink-0 text-ink" />
      <div className="min-w-0">
        <div className="truncate text-[14px] font-semibold text-ink">{value}</div>
        <div className="truncate text-[11.5px] text-muted">{label}</div>
      </div>
    </div>
  );
}

interface AttachableFile {
  id: string;
  name: string;
  size: number;
}

/**
 * Which of a property's files are worth offering for this recipient. The
 * landlord usually wants the certificates; the tenant wants their agreement
 * and the move-in paperwork. Everything else is still listed, just not
 * flagged.
 */
const SUGGESTED: Record<string, RegExp> = {
  landlord: /epc|gas|electric|eicr|certificate|safety|licen[cs]e|inventory|statement/i,
  tenant: /agreement|tenancy|approval|reference|deposit|prescribed|how to rent|inventory|invent/i,
};

/** Send-a-message composer. No SMTP of our own, so it hands off to mail. */
function MessageComposer({
  to,
  who,
  property,
  listingId,
  onClose,
}: {
  to: string | null;
  who: "tenant" | "landlord";
  property: string;
  listingId: string | null;
  onClose: () => void;
}) {
  const [address, setAddress] = useState(to ?? "");
  const [subject, setSubject] = useState(property);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<AttachableFile[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // What's already on file for this property — only askable when the deal
  // matched a REX listing.
  useEffect(() => {
    if (!listingId) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/my/property-files?listingId=${encodeURIComponent(listingId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { files?: AttachableFile[] }) => !cancelled && setFiles(d.files ?? []))
      .catch(() => !cancelled && setFiles([]));
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const send = () => {
    // A web page can't hand attachments to a mail app, so the ticked files
    // download first — they're then sat in Downloads ready to drag in.
    for (const id of picked) {
      const link = document.createElement("a");
      link.href = `/api/my/property-files/${id}`;
      link.download = "";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    const url = `mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
    onClose();
  };

  const suggested = (name: string) => SUGGESTED[who]?.test(name) ?? false;
  const sorted = [...(files ?? [])].sort(
    (a, b) => Number(suggested(b.name)) - Number(suggested(a.name))
  );

  return (
    <div className="panel-bounce card flex h-full flex-col p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[15px]" style={{ fontWeight: 500 }}>
          <DoodleIcon name="mail" size={17} className="text-accent" />
          Message the {who}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="btn-press rounded-full border border-line px-3 py-1 text-[12px] font-medium text-muted transition hover:text-ink"
        >
          Collapse
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">To</span>
          <input
            type="email"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={to ? "" : `The ${who}'s address — it lives on the REX record`}
            className="mt-1 w-full border-0 border-b-[1.5px] border-ink/25 bg-transparent px-1 py-2 text-[13px] outline-none transition focus:border-ink/70"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Subject</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1 w-full border-0 border-b-[1.5px] border-ink/25 bg-transparent px-1 py-2 text-[13px] outline-none transition focus:border-ink/70"
          />
        </label>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={`Write to the ${who}…`}
        className="mt-3 min-h-[120px] w-full flex-1 resize-none rounded-xl border border-line bg-transparent p-3 text-[13px] outline-none transition focus:border-black/30"
      />

      {/* ---- documents already on file for this property ---- */}
      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Attach from this property
          </span>
          {picked.size > 0 ? (
            <span className="text-[11px] text-muted">{picked.size} selected</span>
          ) : null}
        </div>

        {files === null ? (
          <p className="mt-2 text-[12px] text-muted">Checking what&rsquo;s on file…</p>
        ) : sorted.length === 0 ? (
          <p className="mt-2 text-[12px] text-muted">
            Nothing on file for this property yet — anything uploaded on its
            record in My Properties shows up here.
          </p>
        ) : (
          <div className="no-scrollbar mt-2 max-h-32 space-y-1.5 overflow-y-auto">
            {sorted.map((f) => (
              <label
                key={f.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3 py-2 transition hover:border-black/25"
              >
                <input
                  type="checkbox"
                  checked={picked.has(f.id)}
                  onChange={() => toggle(f.id)}
                  className="h-3.5 w-3.5 shrink-0 accent-[#e31f36]"
                />
                <DoodleIcon name="doc" size={14} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{f.name}</span>
                {suggested(f.name) ? (
                  <span className="shrink-0 rounded-full accent-soft-bg px-2 py-0.5 text-[9px] font-semibold accent-text">
                    SUGGESTED
                  </span>
                ) : null}
              </label>
            ))}
          </div>
        )}
        {picked.size > 0 ? (
          <p className="mt-2 text-[11px] text-muted">
            Ticked files download when you send, ready to drag into the email —
            a web page can&rsquo;t attach them for you.
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={send}
        disabled={!address.trim()}
        className="btn-press mt-4 inline-flex w-fit items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white transition disabled:opacity-40"
        style={{ background: BRAND.accent }}
      >
        <DoodleIcon name="mail" size={15} />
        {picked.size > 0 ? `Open in mail with ${picked.size} file${picked.size === 1 ? "" : "s"}` : "Open in your mail app"}
      </button>
    </div>
  );
}

/** Click-into-a-deal dashboard: where the tenancy is, stage by stage. */
// One wide window: the property across the top, the stage board on the left,
// and a right-hand column of panels that expand over each other on demand.
function PropolyDrawer({ a, onClose }: { a: AgentApplication; onClose: () => void }) {
  // Pre-tenancy meta (checklist ticks) arrives with the notes fetch.
  const [meta, setMeta] = useState<DealMeta | null>(null);
  // Which right-hand panel is opened out; null = the resting arrangement.
  type Expanded = null | "notes" | "documents" | "comms" | "tenant" | "landlord";
  const [expanded, setExpanded] = useState<Expanded>(null);

  const p = a.propoly!;
  const cancelled = p.statusKey === "cancelled";
  const currentIdx = PORTAL_STAGES.findIndex((s) => s.key === p.statusKey);
  const lead = a.tenants.find((t) => t.isPrimary) ?? a.tenants[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (expanded ? setExpanded(null) : onClose());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, onClose]);

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
    <SplitDrawer onClose={onClose} hideClose>
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

        {/* ---- header: the property, then the headline numbers ---- */}
        <div className="flex flex-wrap items-center gap-5 pr-12">
          <div className="h-[76px] w-[104px] shrink-0 overflow-hidden rounded-xl bg-page">
            {a.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.image} alt={a.propertyName} className="h-full w-full object-cover" />
            ) : (
              <NoPhoto className="border-0" />
            )}
          </div>

          <div className="min-w-0">
            {/* The address links through to the property itself when we found it. */}
            {a.listingId ? (
              <Link
                href={`/dashboard/listings?open=${encodeURIComponent(a.listingId)}`}
                className="text-[24px] leading-tight tracking-tight decoration-2 underline-offset-4 hover:underline"
                style={{ fontWeight: 500 }}
              >
                {a.propertyName}
              </Link>
            ) : (
              <h2 className="text-[24px] leading-tight tracking-tight" style={{ fontWeight: 500 }}>
                {a.propertyName}
              </h2>
            )}
            <p className="mt-1 text-[13px] text-muted">{a.locality}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2.5 py-0.5 text-[9px] font-semibold ${STAGE_STYLE[a.stage]}`}>
                {a.status.toUpperCase()}
              </span>
              {p.service ? (
                <span className="rounded-full border border-line px-2.5 py-0.5 text-[9px] font-semibold text-muted">
                  {p.service.toUpperCase()}
                </span>
              ) : null}
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-x-8 gap-y-3">
            <HeadStat
              icon="home"
              value={a.offer != null ? `${formatGBP(a.offer)} pcm` : "—"}
              label="Rent"
            />
            <HeadStat
              icon="calendar"
              value={fmtDate(a.startDate) ?? "TBC"}
              label="Tenancy starts"
            />
            {a.occupants != null ? (
              <HeadStat icon="user" value={String(a.occupants)} label={a.occupants === 1 ? "Occupant" : "Occupants"} />
            ) : null}
          </div>
        </div>

        {cancelled ? (
          <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            This deal was cancelled before completion — the stages below show the
            journey it would have taken.
          </p>
        ) : null}

        {a.portal?.override ? (
          <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
            {a.portal.override.by || "The pre-tenancy team"} moved this deal to{" "}
            <span className="font-semibold">{a.status}</span>
            {a.portal.override.at ? ` on ${fmtDate(a.portal.override.at)}` : ""}.
          </p>
        ) : null}

        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.08fr]">
          {/* ================= left: where the tenancy is ================= */}
          <div className="card p-5 sm:p-6">
            <h3 className="flex items-center gap-2 text-[15px]" style={{ fontWeight: 500 }}>
              <DoodleIcon name="lock" size={17} className="text-accent" />
              Application progress
            </h3>

            <ol className="mt-5">
              {PORTAL_STAGES.map((s, i) => {
                const state = cancelled
                  ? "off"
                  : i < currentIdx
                    ? "done"
                    : i === currentIdx
                      ? "current"
                      : "todo";
                const last = i === PORTAL_STAGES.length - 1;
                return (
                  <li key={s.key} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      {state === "done" ? (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                          <svg viewBox="0 0 24 24" className="h-4 w-4 text-emerald-700" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      ) : state === "current" ? (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full accent-soft-bg">
                          <span className="h-2.5 w-2.5 animate-pulse rounded-full" style={{ background: BRAND.accent }} />
                        </span>
                      ) : (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-page">
                          <span className="h-2 w-2 rounded-full bg-black/20" />
                        </span>
                      )}
                      {!last ? (
                        <span className={`w-px flex-1 ${state === "done" ? "bg-emerald-200" : "bg-line"}`} />
                      ) : null}
                    </div>
                    <div className={`min-w-0 flex-1 ${last ? "pb-1" : "pb-5"}`}>
                      <div
                        className={`-mx-2 rounded-lg px-2 py-0.5 ${
                          state === "current" ? "bg-accent-soft" : ""
                        }`}
                      >
                        <p className="flex flex-wrap items-center gap-2 text-[13.5px] leading-6">
                          <span className={state === "todo" || state === "off" ? "text-muted" : "font-semibold text-ink"}>
                            {s.label}
                          </span>
                          {state === "current" ? (
                            <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold accent-text accent-soft-bg">
                              AWAITING
                            </span>
                          ) : null}
                        </p>
                        <p className="text-[12px] text-muted">
                          {state === "done" ? "Completed" : state === "current" ? s.blurb : "Pending"}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            {/* the deal in one line, like the reference's footer strip */}
            <div className="mt-5 grid grid-cols-3 divide-x divide-line rounded-xl border border-line">
              <div className="min-w-0 p-3.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted">
                  <DoodleIcon name="home" size={13} />
                  Property
                </div>
                <p className="mt-1 truncate text-[12.5px] font-medium text-ink">{a.propertyName}</p>
                <p className="truncate text-[11px] text-muted">{a.locality}</p>
              </div>
              <div className="min-w-0 p-3.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted">
                  <DoodleIcon name="user" size={13} />
                  Tenant
                </div>
                <p className="mt-1 truncate text-[12.5px] font-medium text-ink">
                  {lead?.name ?? "—"}
                </p>
                <p className="truncate text-[11px] text-muted">
                  {a.tenants.length > 1 ? `+${a.tenants.length - 1} more` : "Lead applicant"}
                </p>
              </div>
              <div className="min-w-0 p-3.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted">
                  <DoodleIcon name="calendar" size={13} />
                  Tenancy
                </div>
                <p className="mt-1 truncate text-[12.5px] font-medium text-ink">
                  {a.agreementMonths ? `${a.agreementMonths} months` : "—"}
                </p>
                <p className="truncate text-[11px] text-muted">
                  {a.startDate ? `Start: ${fmtDate(a.startDate)}` : "Start TBC"}
                </p>
              </div>
            </div>
          </div>

          {/* ============ right: the people, and whatever's opened out ============ */}
          <div className={expanded === "tenant" || expanded === "landlord" ? "flex" : "space-y-5"}>
            {expanded === "tenant" || expanded === "landlord" ? (
              <MessageComposer
                to={expanded === "tenant" ? (lead?.email ?? null) : null}
                who={expanded === "tenant" ? "tenant" : "landlord"}
                property={`${a.propertyName}, ${a.locality}`}
                listingId={a.listingId ?? null}
                onClose={() => setExpanded(null)}
              />
            ) : null}

            {/* Tenant details — squeezed away while a panel is opened out. */}
            {expanded === null ? (
              <div className="panel-bounce card p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-[15px]" style={{ fontWeight: 500 }}>
                    <DoodleIcon name="user" size={17} className="text-accent" />
                    Tenant details
                  </h3>
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${STAGE_STYLE[a.stage]}`}>
                    {cancelled ? "Cancelled" : "Application in progress"}
                  </span>
                </div>

                {a.tenants.length ? (
                  <div className="mt-4 space-y-4">
                    {a.tenants.map((t, i) => (
                      <div key={i} className={i > 0 ? "border-t border-line pt-4" : ""}>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[15px] font-semibold text-ink">{t.name}</p>
                          {t.isPrimary ? (
                            <span className="rounded-full border border-line px-2 py-0.5 text-[9px] font-semibold text-muted">
                              LEAD
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 space-y-1.5">
                          {t.email ? (
                            <a href={`mailto:${t.email}`} className="flex items-center gap-2 text-[12.5px] text-muted transition hover:text-ink">
                              <DoodleIcon name="mail" size={14} />
                              {t.email}
                            </a>
                          ) : null}
                          {t.phone ? (
                            <a href={`tel:${t.phone}`} className="flex items-center gap-2 text-[12.5px] text-muted transition hover:text-ink">
                              <DoodleIcon name="call" size={14} />
                              {t.phone}
                            </a>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-[13px] text-muted">No tenant details recorded yet.</p>
                )}

                {/* Only the facts Propoly actually gives us — the rest waits for
                    referencing to be wired in rather than showing invented data. */}
                <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 text-[12.5px]">
                  <div>
                    <dt className="text-muted">Holding fee</dt>
                    <dd className="mt-0.5 text-ink">
                      {p.holdingFee != null ? formatGBP(p.holdingFee) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Deposit</dt>
                    <dd className="mt-0.5 text-ink">
                      {p.deposit != null ? formatGBP(p.deposit) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Affordability</dt>
                    <dd className="mt-0.5 text-ink">
                      {a.affordability != null ? `${a.affordability.toFixed(1)}% of income` : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Pets</dt>
                    <dd className="mt-0.5 text-ink">{a.hasPets ? "Yes" : "None declared"}</dd>
                  </div>
                </dl>
              </div>
            ) : null}

            {/* ---- Notes ---- */}
            {expanded === null || expanded === "notes" ? (
              <div className={`card p-5 sm:p-6 ${expanded === "notes" ? "panel-bounce" : ""}`}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-[15px]" style={{ fontWeight: 500 }}>
                    <DoodleIcon name="note" size={17} className="text-accent" />
                    Notes
                  </h3>
                  {expanded === "notes" ? (
                    collapse
                  ) : (
                    <button
                      type="button"
                      onClick={() => setExpanded("notes")}
                      className="btn-press inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[12px] font-medium text-ink transition hover:border-black/30"
                    >
                      <DoodleIcon name="pencil" size={13} />
                      Add note
                    </button>
                  )}
                </div>
                <div className="mt-3">
                  <DealNotesPanel
                    dealId={a.id}
                    placeholder="Reply to pre-tenancy — they see it instantly…"
                    onMeta={setMeta}
                    compact={expanded !== "notes"}
                  />
                </div>
              </div>
            ) : null}

            {/* ---- Documents + Communication, side by side until one opens ---- */}
            {expanded === null ? (
              <div className="grid gap-5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setExpanded("documents")}
                  className="card card-lift p-5 text-left"
                >
                  <h3 className="flex items-center gap-2 text-[14px]" style={{ fontWeight: 500 }}>
                    <DoodleIcon name="doc" size={16} className="text-accent" />
                    Documents
                  </h3>
                  <p className="mt-2 text-[12px] text-muted">
                    {meta && Object.keys(meta.checklist).length
                      ? `${CHECKLIST_ITEMS.filter((i) => meta.checklist[i.key]?.done).length}/${CHECKLIST_ITEMS.length} pre-tenancy steps done`
                      : "Pre-tenancy checklist"}
                  </p>
                  <span className="mt-3 inline-block text-[12px] font-medium text-ink underline-offset-2 hover:underline">
                    View all
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setExpanded("comms")}
                  className="card card-lift p-5 text-left"
                >
                  <h3 className="flex items-center gap-2 text-[14px]" style={{ fontWeight: 500 }}>
                    <DoodleIcon name="message-2" size={16} className="text-accent" />
                    Communication
                  </h3>
                  <p className="mt-2 text-[12px] text-muted">
                    Message the tenant or the landlord
                  </p>
                  <span className="mt-3 inline-block text-[12px] font-medium text-ink underline-offset-2 hover:underline">
                    View all
                  </span>
                </button>
              </div>
            ) : null}

            {/* ---- Documents opened out: the pre-tenancy checklist in full ---- */}
            {expanded === "documents" ? (
              <div className="panel-bounce card p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-[15px]" style={{ fontWeight: 500 }}>
                    <DoodleIcon name="doc" size={17} className="text-accent" />
                    Documents &amp; pre-tenancy steps
                  </h3>
                  {collapse}
                </div>
                {meta && Object.keys(meta.checklist).length ? (
                  <div className="mt-4 space-y-2">
                    {CHECKLIST_ITEMS.map((item) => {
                      const done = meta.checklist[item.key]?.done ?? false;
                      return (
                        <div
                          key={item.key}
                          className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5"
                        >
                          {done ? (
                            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <span className="h-4 w-4 shrink-0 rounded-full border border-line" />
                          )}
                          <span className={`flex-1 text-[13px] ${done ? "text-muted" : "text-ink"}`}>
                            {item.label}
                          </span>
                          <span className="text-[11px] text-muted">
                            {done ? "Done" : "Outstanding"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-4 text-[13px] text-muted">
                    Nothing recorded yet. The signed agreement, deposit protection and
                    inventory appear here as pre-tenancy work through them.
                  </p>
                )}
                <a
                  href={PROPOLY_APP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-press mt-4 inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[12px] font-semibold transition hover:border-black/30"
                >
                  Open the file in Propoly
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 17L17 7M9 7h8v8" />
                  </svg>
                </a>
              </div>
            ) : null}

            {/* ---- Communication opened out ---- */}
            {expanded === "comms" ? (
              <div className="panel-bounce card p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-[15px]" style={{ fontWeight: 500 }}>
                    <DoodleIcon name="message-2" size={17} className="text-accent" />
                    Communication
                  </h3>
                  {collapse}
                </div>
                <p className="mt-4 text-[13px] text-muted">
                  Sent mail isn&rsquo;t fed back into the portal yet, so this is the
                  outbound side only — messages open in your own mail app so they
                  come from you.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setExpanded("tenant")}
                    className="btn-press inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[12.5px] font-semibold transition hover:border-black/30"
                  >
                    <DoodleIcon name="user" size={14} />
                    Message the tenant
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpanded("landlord")}
                    className="btn-press inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[12.5px] font-semibold transition hover:border-black/30"
                  >
                    <DoodleIcon name="home" size={14} />
                    Message the landlord
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* ---- footer actions ---- */}
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-5">
          <button
            type="button"
            onClick={() => setExpanded("landlord")}
            className="btn-press inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-[13px] font-semibold transition hover:border-black/30"
          >
            <DoodleIcon name="home" size={15} />
            Message the landlord
          </button>
          <button
            type="button"
            onClick={() => setExpanded("tenant")}
            className="btn-press inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold text-white transition"
            style={{ background: BRAND.accent }}
          >
            <DoodleIcon name="mail" size={15} />
            Send message to tenant
          </button>
        </div>
      </DrawerPanel>
    </SplitDrawer>
  );
}

/* -------------------------------- drawer -------------------------------- */

// Two windows: the property and the offer on the left, the people on the right.
function Drawer({ a, onClose }: { a: AgentApplication; onClose: () => void }) {
  return (
    <SplitDrawer onClose={onClose}>
      {/* ---- the property & the offer ---- */}
      <DrawerPanel className="p-3 lg:w-[26rem]">
        <PhotoCarousel images={a.image ? [a.image] : []} alt={a.propertyName} />

        <div className="p-5 sm:p-6">
          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${STAGE_STYLE[a.stage]}`}>
            {a.status.toUpperCase()}
          </span>
          <h2 className="mt-3 text-[17px] font-semibold leading-snug">{a.propertyName}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{a.locality}</p>

          <div className="mt-6 grid grid-cols-3 gap-3 border-y border-line py-5 text-[11px] text-muted">
            <div>
              <div className="stat-value text-[18px] text-ink">
                {a.offer != null ? formatGBP(a.offer) : "—"}
              </div>
              Offered / {(a.offerPeriod ?? "month").replace(/^Per /i, "").toLowerCase()}
            </div>
            <div>
              <div className="text-[13px] font-medium text-ink">{fmtDate(a.startDate) ?? "—"}</div>
              Proposed start
            </div>
            <div>
              <div className="text-[13px] font-medium text-ink">
                {a.agreementMonths ? `${a.agreementMonths} months` : "—"}
              </div>
              Agreement
            </div>
          </div>

          {/* The rest — only when REX actually has it */}
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
            {a.affordability != null ? (
              <span>
                Rent is{" "}
                <span className="font-medium text-ink">{a.affordability.toFixed(1)}%</span>{" "}
                of their income
              </span>
            ) : null}
            {a.occupants != null ? <span>{a.occupants} occupant{a.occupants === 1 ? "" : "s"}</span> : null}
            {a.hasPets ? <span>Has pets</span> : null}
            {a.dateReceived ? <span>Received {fmtDate(a.dateReceived)}</span> : null}
          </div>
        </div>
      </DrawerPanel>

      {/* ---- the people ---- */}
      <DrawerPanel className="lg:w-[24rem]">
        <div className="p-5 sm:p-6">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
            {a.tenants.length === 1 ? "Applicant" : `Applicants (${a.tenants.length})`}
          </h3>
          <div className="mt-3 space-y-2.5">
            {a.tenants.length ? (
              a.tenants.map((t, i) => (
                <div key={i} className="rounded-xl border border-line p-4">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium">{t.name}</p>
                    {t.isPrimary ? (
                      <span className="rounded-full border border-line bg-page px-1.5 py-0.5 text-[9px] font-semibold text-muted">
                        LEAD
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-muted">
                    {t.email ? <a href={`mailto:${t.email}`} className="hover:text-ink">{t.email}</a> : null}
                    {t.phone ? <a href={`tel:${t.phone}`} className="hover:text-ink">{t.phone}</a> : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-[13px] text-muted">No applicant details recorded.</p>
            )}
          </div>

          {a.conditions ? (
            <p className="mt-5 rounded-xl border border-line p-4 text-[12px] text-muted">
              <span className="font-medium text-ink">Conditions: </span>
              {a.conditions}
            </p>
          ) : null}
          {a.notes ? (
            <p className="mt-2 rounded-xl border border-line p-4 text-[12px] italic text-muted">
              {a.notes}
            </p>
          ) : null}
        </div>
      </DrawerPanel>
    </SplitDrawer>
  );
}

/* --------------------------------- page --------------------------------- */

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<AgentApplication[] | null>(null);
  const [linked, setLinked] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<AgentApplication | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("default");
  const [fromPropoly, setFromPropoly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/my/applications", { cache: "no-store" })
      .then((r) => r.json())
      .then(
        (d: {
          linked?: boolean;
          applications?: AgentApplication[];
          source?: string;
          error?: string;
        }) => {
          if (cancelled) return;
          setLinked(d.linked !== false);
          setApplications(d.applications ?? []);
          setFromPropoly(d.source === "propoly");
          setError(d.error ?? null);
        }
      )
      .catch(() => !cancelled && setError("Couldn't load your applications."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const all = useMemo(() => applications ?? [], [applications]);
  const live = useMemo(() => all.filter((a) => a.stage !== "unsuccessful"), [all]);
  const closed = all.length - live.length;

  const count = (s: ApplicationStage) => all.filter((a) => a.stage === s).length;

  // One filter state, driven by both the quick tabs and the Filter dropdown.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = showClosed || filter === "unsuccessful" ? all : live;
    const list = base.filter((a) => {
      if (filter !== "all" && a.stage !== filter) return false;
      if (q) {
        const hay = `${a.propertyName} ${a.locality} ${a.tenants.map((t) => t.name).join(" ")}`;
        if (!hay.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    if (sort === "rent") return [...list].sort((a, b) => (b.offer ?? 0) - (a.offer ?? 0));
    if (sort === "moveIn")
      return [...list].sort((a, b) => (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999"));
    if (sort === "property") return [...list].sort((a, b) => a.propertyName.localeCompare(b.propertyName));
    return list;
  }, [all, live, filter, search, sort, showClosed]);

  const movingIn30 = all.filter((a) => {
    if (!a.startDate) return false;
    const d = Math.round((new Date(a.startDate).getTime() - Date.now()) / 86_400_000);
    return d >= 0 && d <= 30;
  }).length;
  const monthlyRent = live.reduce((t, a) => t + (a.offer ?? 0), 0);
  const stageLabel = (s: ApplicationStage) =>
    fromPropoly
      ? s === "received"
        ? "Getting started"
        : s === "communicated"
          ? "Referencing & compliance"
          : "Agreement & move-in"
      : s === "received"
        ? "Received"
        : s === "communicated"
          ? "With landlord"
          : "Accepted";

  return (
    <div className="outline-cards soft-cards space-y-6">
      <div className="enter enter-up" style={enterAt(60)}>
        <h1 className="text-xl font-semibold tracking-tight">Applications</h1>
        <p className="mt-1 text-[13px] text-muted">
          {fromPropoly
            ? "Every tenancy in progress and exactly where it's up to — live from Propoly. Tap one for the full picture."
            : "Offers on your properties and where each one is up to. Tap one for the applicant."}
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
        <Loader label="Loading your pipeline…" />
      ) : linked && !error && all.length === 0 ? (
        <div className="card p-10 text-center text-[13px] text-muted">
          No applications yet. Offers on your properties will appear here.
        </div>
      ) : all.length > 0 ? (
        <>
          <div
            className="enter enter-up flex min-h-[40px] flex-wrap items-center justify-between gap-3"
            style={enterAt(140)}
          >
            <p className="text-[13px] text-muted">
              <span className="font-semibold text-ink">
                {live.length} {live.length === 1 ? "application" : "applications"}
              </span>{" "}
              in progress
              {monthlyRent > 0 ? (
                <>
                  {" · "}
                  <span className="font-semibold text-ink">{formatGBP(monthlyRent)}</span> a month
                </>
              ) : null}
            </p>
            <FilterBar
              options={[
                { key: "all", label: "All applications" },
                { key: "received", label: stageLabel("received") },
                { key: "communicated", label: stageLabel("communicated") },
                { key: "accepted", label: stageLabel("accepted") },
                { key: "unsuccessful", label: "Unsuccessful" },
              ]}
              value={filter}
              onChange={setFilter}
              search={search}
              onSearch={setSearch}
              placeholder="Search property or tenant…"
            />
          </div>

          {/* ---- the overview bar ---- */}
          <div className="enter enter-up" style={enterAt(170)}>
            <StatStrip
              items={[
                { icon: "file-contract", value: String(live.length), label: "In progress" },
                { icon: "user", value: String(count("received")), label: stageLabel("received") },
                { icon: "checklist", value: String(count("communicated")), label: stageLabel("communicated") },
                {
                  icon: "key",
                  value: String(movingIn30),
                  label: "Moving in within 30 days",
                  dot: movingIn30 > 0 ? "amber" : undefined,
                },
                { icon: "wallet", value: formatGBP(monthlyRent), label: "Rent a month" },
              ]}
            />
          </div>

          {/* ---- quick cuts + sort ---- */}
          <div className="enter enter-up" style={enterAt(190)}>
            <QuickTabs
              tabs={[
                { key: "all", label: "All applications", count: live.length },
                { key: "received", label: stageLabel("received"), count: count("received"), dot: "blue" },
                { key: "communicated", label: stageLabel("communicated"), count: count("communicated"), dot: "amber" },
                { key: "accepted", label: stageLabel("accepted"), count: count("accepted"), dot: "green" },
                ...(closed > 0
                  ? [{ key: "unsuccessful", label: "Unsuccessful", count: closed } as const]
                  : []),
              ]}
              value={filter}
              onChange={setFilter}
              sort={sort}
              onSort={setSort}
              sortOptions={[
                { key: "default", label: "Newest first" },
                { key: "moveIn", label: "Move-in date" },
                { key: "rent", label: "Highest rent" },
                { key: "property", label: "Property A–Z" },
              ]}
            />
          </div>

          {shown.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-muted">
              Nothing matches — clear the filter or search.
            </p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 2xl:grid-cols-3">
              {shown.map((a, i) => (
                <ApplicationTile key={a.id} a={a} delay={200 + i * 50} onOpen={() => setOpen(a)} />
              ))}
            </div>
          )}
        </>
      ) : null}

      {open ? (
        open.propoly ? (
          <PropolyDrawer a={open} onClose={() => setOpen(null)} />
        ) : (
          <Drawer a={open} onClose={() => setOpen(null)} />
        )
      ) : null}
    </div>
  );
}
