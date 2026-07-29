"use client";

// Applications — the agent's live let pipeline, from REX tenancy applications.
//
// Same tile → click → detail shape as My Properties and Compliance. Progressive
// reveal twice over: unsuccessful applications are hidden until asked for (they
// outnumber the live ones and drown the pipeline), and the applicant detail only
// appears on the click.

import { useEffect, useMemo, useState } from "react";
import Loader from "@/components/Loader";
import { formatGBP } from "@/lib/format";
import { BRAND } from "@/lib/brand";
import { DealNotesPanel } from "@/components/DealNotes";
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
    return (
      <div className="flex h-full w-full items-center justify-center bg-page text-muted">
        <svg className="h-5 w-5 opacity-40" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <rect x={3} y={5} width={18} height={14} rx={2} />
          <path d="M3 15l5-5 4 4 3-3 6 6" />
          <circle cx={8.5} cy={9.5} r={1} />
        </svg>
      </div>
    );
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

/** Click-into-a-deal dashboard: where the tenancy is, stage by stage. */
// Two windows: the deal and its stages on the left; the tenants, checklist and
// the running conversation with pre-tenancy (Kirstie's side) on the right.
function PropolyDrawer({ a, onClose }: { a: AgentApplication; onClose: () => void }) {
  // Pre-tenancy meta (checklist ticks) arrives with the notes fetch.
  const [meta, setMeta] = useState<DealMeta | null>(null);

  const p = a.propoly!;
  const cancelled = p.statusKey === "cancelled";
  const currentIdx = PORTAL_STAGES.findIndex((s) => s.key === p.statusKey);

  return (
    <SplitDrawer onClose={onClose}>
      {/* ---- the deal & where it is ---- */}
      <DrawerPanel className="lg:w-[26rem]">
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${STAGE_STYLE[a.stage]}`}>
              {a.status.toUpperCase()}
            </span>
            {p.service ? (
              <span className="rounded-full border border-line bg-page px-2 py-0.5 text-[9px] font-semibold text-muted">
                {p.service.toUpperCase()}
              </span>
            ) : null}
          </div>
          <h2 className="mt-3 text-[17px] font-semibold leading-snug">{a.propertyName}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{a.locality}</p>

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

          {/* ---- the stage board ---- */}
          <ol className="mt-6">
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
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100">
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-green-700" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    ) : state === "current" ? (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full accent-soft-bg">
                        <span className="h-2.5 w-2.5 animate-pulse rounded-full" style={{ background: BRAND.accent }} />
                      </span>
                    ) : (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-page">
                        <span className="h-2 w-2 rounded-full bg-gray-300" />
                      </span>
                    )}
                    {!last ? (
                      <span className={`w-px flex-1 ${state === "done" ? "bg-green-200" : "bg-line"}`} />
                    ) : null}
                  </div>
                  <div className={last ? "pb-1" : "pb-5"}>
                    <p
                      className={`text-[13px] font-semibold leading-6 ${
                        state === "todo" || state === "off" ? "text-muted" : "text-ink"
                      }`}
                    >
                      {s.label}
                      {state === "current" ? (
                        <span className="ml-2 rounded-full accent-soft-bg px-2 py-0.5 text-[9px] font-semibold accent-text">
                          HAPPENING NOW
                        </span>
                      ) : null}
                    </p>
                    {state === "current" ? (
                      <>
                        <p className="mt-0.5 text-[12px] text-muted">{s.blurb}</p>
                        <a
                          href={PROPOLY_APP_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium accent-text underline-offset-2 hover:underline"
                        >
                          Chase this in Propoly
                          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 5h5v5M19 5l-8 8" />
                          </svg>
                        </a>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>

          {/* ---- the numbers ---- */}
          <div className="mt-6 grid grid-cols-2 gap-3 border-y border-line py-5 text-[11px] text-muted">
            <div>
              <div className="stat-value text-[18px] text-ink">{a.offer != null ? formatGBP(a.offer) : "—"}</div>
              Rent / month
            </div>
            <div>
              <div className="stat-value text-[18px] text-ink">{p.deposit != null ? formatGBP(p.deposit) : "—"}</div>
              Deposit
            </div>
            <div>
              <div className="stat-value text-[18px] text-ink">{p.holdingFee != null ? formatGBP(p.holdingFee) : "—"}</div>
              Holding fee
            </div>
            <div>
              <div className="text-[13px] font-medium text-ink">{fmtDate(a.startDate) ?? "TBC"}</div>
              Move-in
            </div>
          </div>

          {/* ---- go do it ---- */}
          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted">
              Live from Propoly — updates within a minute of anything moving.
            </p>
            <a
              href={PROPOLY_APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-press shrink-0 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white transition"
              style={{ background: BRAND.accent }}
            >
              Open in Propoly
            </a>
          </div>
        </div>
      </DrawerPanel>

      {/* ---- the people & the pre-tenancy side ---- */}
      <DrawerPanel className="lg:w-[26rem]">
        <div className="p-5 sm:p-6">
          {/* ---- tenants ---- */}
          <div>
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
              {a.tenants.length === 1 ? "Tenant" : `Tenants (${a.tenants.length})`}
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
                <p className="text-[13px] text-muted">No tenant details recorded yet.</p>
              )}
            </div>
          </div>

          {/* ---- pre-tenancy checklist (Kirstie ticks, you watch) ---- */}
          {meta && Object.keys(meta.checklist).length > 0 ? (
            <div className="mt-6">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                Pre-tenancy checklist
                <span className="ml-2 font-normal normal-case">
                  {CHECKLIST_ITEMS.filter((i) => meta.checklist[i.key]?.done).length}/
                  {CHECKLIST_ITEMS.length} done
                </span>
              </h3>
              <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {CHECKLIST_ITEMS.map((item) => {
                  const done = meta.checklist[item.key]?.done ?? false;
                  return (
                    <div key={item.key} className="flex items-center gap-2 text-[12px]">
                      {done ? (
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-line" />
                      )}
                      <span className={done ? "text-muted line-through" : "text-ink"}>
                        {item.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* ---- notes with the pre-tenancy team ---- */}
          <div className="mt-6">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
              Notes with pre-tenancy
            </h3>
            <div className="mt-1">
              <DealNotesPanel
                dealId={a.id}
                placeholder="Reply to pre-tenancy — they see it instantly…"
                onMeta={setMeta}
              />
            </div>
          </div>
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
  const shown = showClosed ? all : live;

  const count = (s: ApplicationStage) => all.filter((a) => a.stage === s).length;

  return (
    <div className="space-y-6">
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
          <section className="enter enter-up grid grid-cols-3 gap-3" style={enterAt(140)}>
            {(["received", "communicated", "accepted"] as ApplicationStage[]).map((s) => (
              <div key={s} className="card p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {fromPropoly
                    ? s === "received"
                      ? "Getting started"
                      : s === "communicated"
                        ? "Referencing & compliance"
                        : "Agreement & move-in"
                    : s === "received"
                      ? "Received"
                      : s === "communicated"
                        ? "With landlord"
                        : "Accepted"}
                </div>
                <div className="stat-value mt-1 text-[24px]">{count(s)}</div>
              </div>
            ))}
          </section>

          {closed > 0 ? (
            <button
              type="button"
              onClick={() => setShowClosed((v) => !v)}
              className="text-[12px] font-medium text-muted underline decoration-dotted underline-offset-2 transition hover:text-ink"
            >
              {showClosed
                ? `Hide ${closed} unsuccessful`
                : `Show ${closed} unsuccessful`}
            </button>
          ) : null}

          <div className="grid gap-6 sm:grid-cols-2 2xl:grid-cols-3">
            {shown.map((a, i) => (
              <ApplicationTile key={a.id} a={a} delay={200 + i * 50} onOpen={() => setOpen(a)} />
            ))}
          </div>
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
