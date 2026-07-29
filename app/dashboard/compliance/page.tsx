"use client";

// Compliance — what's outstanding across the agent's properties, worst first.
//
// Same shape as My Properties on purpose: tile → click → detail. The tile says
// how much needs doing; the drawer says exactly what. Property compliance only —
// REX also tracks contact-level checks (AML, Right to Rent), which is a
// different job and deliberately not mixed in here.

import { useEffect, useState } from "react";
import Loader from "@/components/Loader";
import NoPhoto from "@/components/NoPhoto";
import type { ComplianceItem, ComplianceState, PropertyCompliance } from "@/lib/rex-stats";

const enterAt = (ms: number) =>
  ({ "--enter-delay": `${ms}ms` }) as React.CSSProperties;

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

/* -------------------------------- photo -------------------------------- */

function Photo({ p }: { p: PropertyCompliance }) {
  if (!p.image) {
    return <NoPhoto />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={p.image} alt={p.name} loading="lazy" className="h-full w-full object-cover" />;
}

/* --------------------------------- tile --------------------------------- */

function ComplianceTile({
  p,
  delay,
  onOpen,
}: {
  p: PropertyCompliance;
  delay: number;
  onOpen: () => void;
}) {
  const worst = p.items.some((i) => i.state === "expired")
    ? "expired"
    : p.outstanding > 0
      ? "expiring"
      : "valid";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="enter enter-up card btn-press flex min-h-[210px] text-left transition hover:border-black/20"
      style={enterAt(delay)}
    >
      <div className="flex min-w-0 flex-1 flex-col p-6">
        <span
          className={`w-fit rounded-full border px-2 py-0.5 text-[9px] font-semibold ${
            STATE_STYLE[worst as ComplianceState]
          }`}
        >
          {p.outstanding > 0
            ? `${p.outstanding} OUTSTANDING`
            : p.items.length
              ? "ALL CLEAR"
              : "NOTHING RECORDED"}
        </span>

        <h3 className="mt-3.5 truncate text-[14px] font-semibold leading-snug">{p.name}</h3>
        <p className="mt-0.5 truncate text-[12px] text-muted">{p.locality}</p>

        {/* A dot per item — the shape of the problem, before you click in. */}
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-4">
          {p.items.length ? (
            p.items.map((i) => (
              <span
                key={i.type}
                title={`${i.label} — ${stateLabel(i)}`}
                className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[i.state]}`}
              />
            ))
          ) : (
            <span className="text-[11px] text-muted">No compliance records</span>
          )}
        </div>
      </div>

      <div className="w-[38%] shrink-0 p-3 pl-0">
        <div className="relative h-full w-full overflow-hidden rounded-xl bg-page">
          <Photo p={p} />
        </div>
      </div>
    </button>
  );
}

/* -------------------------------- drawer -------------------------------- */

function Drawer({ p, onClose }: { p: PropertyCompliance; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Only what needs a human gets a full row. Everything already in date is real
  // information but not news, so it goes half-size, two-up — a dozen items fits
  // in a few rows instead of a screen of scrolling.
  const outstanding = p.items.filter((i) => needsWork(i.state));
  const settled = p.items.filter((i) => !needsWork(i.state));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-12"
      onClick={onClose}
    >
      {/* Wider than the property drawer: compliance is a list of pairs, and the
          extra width is what keeps it to a few rows rather than a scroll. */}
      <div
        className="modal-pop my-auto w-full max-w-2xl rounded-2xl bg-card p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative h-44 w-full overflow-hidden rounded-xl bg-page">
          <Photo p={p} />
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

        <div className="p-6 sm:p-8">
          <h2 className="text-[17px] font-semibold leading-snug">{p.name}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{p.locality}</p>

          <p className="mt-5 text-[13px] text-muted">
            {p.outstanding > 0 ? (
              <>
                <span className="font-semibold text-ink">
                  {p.outstanding} {p.outstanding === 1 ? "item needs" : "items need"} attention
                </span>{" "}
                on this property.
              </>
            ) : p.items.length ? (
              "Everything on file is in date."
            ) : (
              "No compliance records against this property yet."
            )}
          </p>

          {/* Needs a human — full width, hard to miss */}
          {outstanding.length ? (
            <div className="mt-6 space-y-2.5">
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

          {/* Settled — half-size, two-up. Still there, just not shouting. */}
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

          <p className="mt-6 text-[11px] text-muted">
            Live from REX. Certificates are updated in REX — this is the view, not
            the record.
          </p>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- page --------------------------------- */

export default function CompliancePage() {
  const [properties, setProperties] = useState<PropertyCompliance[] | null>(null);
  const [linked, setLinked] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<PropertyCompliance | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/my/compliance", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { linked?: boolean; properties?: PropertyCompliance[]; error?: string }) => {
        if (cancelled) return;
        setLinked(d.linked !== false);
        setProperties(d.properties ?? []);
        setError(d.error ?? null);
      })
      .catch(() => !cancelled && setError("Couldn't load your compliance."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const all = properties ?? [];
  const flagged = all.filter((p) => p.outstanding > 0);
  const totalOutstanding = all.reduce((t, p) => t + p.outstanding, 0);

  return (
    // Same outline treatment as the rest of the portal.
    <div className="outline-cards space-y-6">
      <div className="enter enter-up" style={enterAt(60)}>
        <h1 className="text-xl font-semibold tracking-tight">Compliance</h1>
        <p className="mt-1 text-[13px] text-muted">
          Anything outstanding across your properties, worst first. Tap one to see
          what needs doing.
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
        <Loader label="Checking your certificates…" />
      ) : linked && !error && all.length === 0 ? (
        <div className="card p-10 text-center text-[13px] text-muted">
          No properties to check.
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
            {totalOutstanding > 0 ? (
              <>
                <span className="font-semibold">
                  {totalOutstanding} {totalOutstanding === 1 ? "item" : "items"} outstanding
                </span>{" "}
                across {flagged.length} of your {all.length} properties.
              </>
            ) : (
              <>Everything on file is in date across all {all.length} properties.</>
            )}
          </div>

          <div className="grid gap-6 sm:grid-cols-2 2xl:grid-cols-3">
            {all.map((p, i) => (
              <ComplianceTile
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
