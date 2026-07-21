"use client";

// Admin tab: Assistant — Susan's briefing library for the TLE Assistant.
// Anything saved here is handed to the chat on every question, so it can
// answer with TLE's own guidance (fees, processes, policies, how-tos).
// Plain text in, plain text out: paste or upload .txt/.md files.

import { useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/format";

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

export default function AssistantTab({ month }: { month: string }) {
  void month; // the knowledge base is not month-scoped
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/knowledge", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("Couldn't load the knowledge base.");
        return (await r.json()) as { entries: KnowledgeEntry[] };
      })
      .then((d) => !cancelled && setEntries(d.entries))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  function startNew() {
    setEditingId(null);
    setTitle("");
    setContent("");
    setNotice(null);
  }

  function startEdit(entry: KnowledgeEntry) {
    setEditingId(entry.id);
    setTitle(entry.title);
    setContent(entry.content);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    if (!title.trim() || !content.trim() || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, title, content }),
      });
      const data = (await res.json()) as { entry?: KnowledgeEntry; error?: string };
      if (!res.ok || !data.entry) throw new Error(data.error ?? "Couldn't save.");
      setEntries((prev) => {
        const others = prev.filter((e) => e.id !== data.entry!.id);
        return [data.entry!, ...others];
      });
      startNew();
      setNotice("Saved — the assistant knows it already.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(entry: KnowledgeEntry) {
    if (!window.confirm(`Delete "${entry.title}"? The assistant will forget it immediately.`)) {
      return;
    }
    const res = await fetch(`/api/admin/knowledge?id=${encodeURIComponent(entry.id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      if (editingId === entry.id) startNew();
    }
  }

  function onUpload(file: File) {
    if (!/\.(txt|md|markdown|csv)$/i.test(file.name)) {
      setNotice("Text files only for now (.txt, .md, .csv) — paste content from PDFs/Word docs instead.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setContent((prev) => (prev.trim() ? `${prev}\n\n${text}` : text));
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
      setNotice(null);
    };
    reader.readAsText(file);
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="text-sm font-semibold">The assistant&rsquo;s briefing library</h2>
        <p className="mt-1 max-w-2xl text-[13px] text-muted">
          Everything saved here is handed to the TLE Assistant on the agents&rsquo;
          dashboard, alongside their live figures. Add fee structures, processes,
          policies, FAQs — anything you&rsquo;d want it to answer with. Changes take
          effect on the very next question.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        {/* ---- editor ---- */}
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">
              {editingId ? "Edit entry" : "Add an entry"}
            </h3>
            {editingId ? (
              <button
                type="button"
                onClick={startNew}
                className="text-[12px] font-medium text-muted transition hover:text-ink"
              >
                Cancel — add new instead
              </button>
            ) : null}
          </div>

          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title — e.g. “TLE management fees 2026”"
            className="mt-3 w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] outline-none transition focus:border-black/25"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="The information itself — plain text. The assistant quotes and references this at will."
            rows={12}
            className="mt-2 w-full resize-y rounded-lg border border-line bg-white px-3 py-2 text-[13px] leading-relaxed outline-none transition focus:border-black/25"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !title.trim() || !content.trim()}
              className="btn-press rounded-lg bg-ink px-3.5 py-2 text-[13px] font-semibold text-white transition disabled:opacity-40"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Add to the library"}
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="btn-press rounded-lg border border-line px-3.5 py-2 text-[13px] font-medium text-muted transition hover:text-ink"
            >
              Upload a text file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.markdown,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.target.value = "";
              }}
            />
            <span className="text-[11px] text-muted">{content.length.toLocaleString()} characters</span>
          </div>

          {notice ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">{notice}</p>
          ) : null}
        </section>

        {/* ---- library ---- */}
        <section className="card p-5">
          <h3 className="text-[13px] font-semibold">In the library</h3>
          {loading ? (
            <p className="mt-3 text-[13px] text-muted">Loading…</p>
          ) : error ? (
            <p className="mt-3 text-[13px] text-red-600">{error}</p>
          ) : entries.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted">
              Nothing yet — the assistant currently only knows the agents&rsquo; figures.
              Add your first entry on the left.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {entries.map((entry) => (
                <li key={entry.id} className="rounded-xl border border-line p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{entry.title}</p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {formatDate(entry.updatedAt)} · {entry.content.length.toLocaleString()} characters
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(entry)}
                        className="text-[12px] font-medium text-muted transition hover:text-ink"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(entry)}
                        className="text-[12px] font-medium text-red-500 transition hover:text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
