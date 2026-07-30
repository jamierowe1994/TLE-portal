"use client";

import { useEffect, useRef, useState } from "react";
import type { PropertyNote } from "@/lib/property-notes-store";

// The conversation log against a property: agent's notes on the left as
// outline bubbles, the team's on the right filled in. Saving folds the
// composer shut, flies the new note up into the thread, then a fresh
// composer folds back out.

export default function PropertyNotes({
  listingId,
  name,
}: {
  listingId: string;
  /** Used in the composer's placeholder. */
  name: string;
}) {
  const [notes, setNotes] = useState<PropertyNote[] | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // The just-saved note id — it gets the fly-in entrance.
  const [floating, setFloating] = useState<string | null>(null);
  const [folding, setFolding] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/my/property-notes?listingId=${encodeURIComponent(listingId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { notes?: PropertyNote[]; me?: string }) => {
        if (cancelled) return;
        setNotes(d.notes ?? []);
        setMeId(d.me ?? null);
      })
      .catch(() => !cancelled && setNotes([]));
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  // Newest joins the bottom and pushes the rest up, so stay pinned there.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [notes]);

  async function save() {
    const text = note.trim();
    if (!text || saving) return;
    setSaving(true);
    setFolding(true);
    try {
      // Let the fold play in full even when the API answers instantly —
      // the choreography is the point.
      const [res] = await Promise.all([
        fetch("/api/my/property-notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId, text }),
        }),
        new Promise((r) => setTimeout(r, 380)),
      ]);
      const data = (await res.json()) as { note?: PropertyNote };
      if (res.ok && data.note) {
        setNotes((prev) => [...(prev ?? []), data.note!]);
        setFloating(data.note.id);
        setNote("");
      }
    } catch {
      /* keep the text so nothing is lost */
    } finally {
      setSaving(false);
      setTimeout(() => setFolding(false), 80);
      setTimeout(() => setFloating(null), 900);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={logRef} className="no-scrollbar min-h-[120px] flex-1 space-y-2 overflow-y-auto pr-1">
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
                  floating === n.id ? "note-fly" : ""
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
                    {new Date(n.createdAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className={folding ? "note-fold" : floating ? "note-unfold" : ""}>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && note.trim()) {
              e.preventDefault();
              void save();
            }
          }}
          placeholder={`Add a note about ${name}…`}
          className="mt-3 w-full border-0 border-b-[1.5px] border-ink/25 bg-transparent px-1 py-2.5 text-[13px] outline-none transition focus:border-ink/70"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={!note.trim() || saving}
          className="btn-press mt-2.5 rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-white transition disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save note"}
        </button>
      </div>
    </div>
  );
}
