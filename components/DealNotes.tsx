"use client";

// Shared two-way notes UI for a Propoly deal — rendered in the agent's
// Applications drawer and in Kirstie's /pretenancy drawer. Notes written on
// either side land in the same thread via /api/deals/:id/notes.

import { useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";
import type { DealMeta, DealNote } from "@/lib/types";

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotesThread({
  notes,
  maxHeightClass = "max-h-64",
}: {
  notes: DealNote[] | null;
  /** Tailwind max-height for the scrolling thread (pretenancy passes taller). */
  maxHeightClass?: string;
}) {
  if (notes == null) {
    return <div className="mt-2 h-16 animate-pulse rounded-xl bg-page" />;
  }
  if (notes.length === 0) {
    return (
      <p className="mt-2 rounded-xl border border-dashed border-line px-3.5 py-3 text-[12px] text-muted">
        No notes yet — anything written here is shared between pre-tenancy and the agent.
      </p>
    );
  }
  return (
    <div className={`mt-2 ${maxHeightClass} space-y-2 overflow-y-auto pr-1`}>
      {notes.map((n) =>
        n.kind === "system" ? (
          // Auto-logged activity line (stage moves, checklist ticks, follow-ups)
          <p key={n.id} className="px-2 py-0.5 text-center text-[11px] text-muted">
            {n.authorName.split(" ")[0]} {n.text} · {fmtDateTime(n.createdAt)}
          </p>
        ) : (
        <div
          key={n.id}
          className={`rounded-xl px-3.5 py-2.5 text-[13px] ${
            n.kind === "private"
              ? "border border-dashed border-line bg-page"
              : n.authorRole === "agent"
                ? "border border-line bg-page"
                : "accent-soft-bg border border-red-100"
          }`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold">
              {n.authorName}
              <span className="ml-1.5 font-normal text-muted">
                {n.kind === "private"
                  ? "· only you"
                  : n.authorRole === "pretenancy"
                    ? "· pre-tenancy"
                    : n.authorRole === "admin"
                      ? "· admin"
                      : "· agent"}
              </span>
            </span>
            <span className="shrink-0 text-[10px] text-muted">{fmtDateTime(n.createdAt)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap leading-snug">{n.text}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Self-contained thread + composer: loads the deal's notes and meta, lets the
 * viewer reply. onMeta fires once the meta arrives (the agent drawer uses it
 * to show Kirstie's checklist progress).
 */
export function DealNotesPanel({
  dealId,
  placeholder,
  onMeta,
}: {
  dealId: string;
  placeholder: string;
  onMeta?: (meta: DealMeta) => void;
}) {
  const [notes, setNotes] = useState<DealNote[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${dealId}/notes`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { notes?: DealNote[]; meta?: DealMeta }) => {
        if (cancelled) return;
        setNotes(d.notes ?? []);
        if (d.meta && onMeta) onMeta(d.meta);
      })
      .catch(() => !cancelled && setNotes([]));
    return () => {
      cancelled = true;
    };
    // onMeta is a render-scoped callback — the fetch should run once per deal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const d = (await res.json()) as { note?: DealNote; error?: string };
      if (!res.ok || !d.note) throw new Error(d.error ?? "Couldn't add the note.");
      setNotes((prev) => [...(prev ?? []), d.note!]);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <NotesThread notes={notes} />
      {error ? <p className="mt-2 text-[12px] text-accent">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void send()}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3.5 py-2 text-[13px] outline-none transition focus:border-gray-400"
        />
        <button
          type="button"
          disabled={busy || !draft.trim()}
          onClick={() => void send()}
          className="btn-press shrink-0 rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white transition disabled:opacity-50"
          style={{ background: BRAND.accent }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
