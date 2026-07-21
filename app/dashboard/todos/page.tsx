"use client";

// To-dos — the agent's own reminder list. Anything they need to chase lives
// here: free-text note, optional due date/time, the platform it happens on,
// and the property/tenant it relates to. The TLE Assistant reads this list
// when asked "what do I need to do?", and can add/complete items itself
// mid-conversation — both ends stay in sync through /api/my/todos.

import { useEffect, useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { PLATFORMS } from "@/lib/platforms";

const enterAt = (ms: number) =>
  ({ "--enter-delay": `${ms}ms` }) as React.CSSProperties;

interface Todo {
  id: string;
  note: string;
  dueAt: string | null;
  platform: string | null;
  property: string | null;
  tenant: string | null;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

const PLATFORM_OPTIONS = PLATFORMS.filter((p) => p.section === "platforms").map(
  (p) => p.name
);

function fmtDue(iso: string | null): { label: string; overdue: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { label: iso, overdue: false };
  const hasTime = /T\d{2}:\d{2}/.test(iso) && !/T00:00(:00)?$/.test(iso);
  const label = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = hasTime
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : null;
  return {
    label: time ? `${label} · ${time}` : label,
    overdue: d.getTime() < Date.now(),
  };
}

export default function TodosPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  // add form
  const [note, setNote] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [platform, setPlatform] = useState("");
  const [property, setProperty] = useState("");
  const [tenant, setTenant] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/my/todos", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("Couldn't load your to-dos.");
        return (await r.json()) as { todos: Todo[] };
      })
      .then((d) => !cancelled && setTodos(d.todos))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Load failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const open = useMemo(() => todos.filter((t) => !t.done), [todos]);
  const done = useMemo(() => todos.filter((t) => t.done), [todos]);

  async function add() {
    if (!note.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/my/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note,
          dueAt: dueAt || null,
          platform: platform || null,
          property: property || null,
          tenant: tenant || null,
        }),
      });
      const data = (await res.json()) as { todo?: Todo };
      if (res.ok && data.todo) {
        setTodos((prev) => [data.todo!, ...prev]);
        setNote("");
        setDueAt("");
        setPlatform("");
        setProperty("");
        setTenant("");
        setMoreOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggle(t: Todo) {
    // optimistic — flip locally, reconcile with the server response
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x)));
    const res = await fetch("/api/my/todos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id, done: !t.done }),
    });
    if (!res.ok) {
      setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: t.done } : x)));
    }
  }

  async function remove(t: Todo) {
    setTodos((prev) => prev.filter((x) => x.id !== t.id));
    await fetch(`/api/my/todos?id=${encodeURIComponent(t.id)}`, { method: "DELETE" });
  }

  const chip = "inline-flex items-center gap-1 rounded-full bg-page px-2 py-0.5 text-[11px] text-muted";

  const TodoRow = ({ t }: { t: Todo }) => {
    const due = fmtDue(t.dueAt);
    return (
      <li className="flex items-start gap-3 rounded-xl border border-line bg-card p-3.5">
        <button
          type="button"
          onClick={() => void toggle(t)}
          aria-label={t.done ? "Mark as not done" : "Mark as done"}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
            t.done ? "border-transparent" : "border-line hover:border-black/30"
          }`}
          style={t.done ? { background: BRAND.accent } : undefined}
        >
          {t.done ? (
            <svg viewBox="0 0 24 24" className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 13l4 4L19 7" />
            </svg>
          ) : null}
        </button>
        <div className="min-w-0 flex-1">
          <p className={`text-[14px] leading-snug ${t.done ? "text-muted line-through" : "text-ink"}`}>
            {t.note}
          </p>
          {due || t.platform || t.property || t.tenant ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {due ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                    due.overdue && !t.done
                      ? "bg-red-50 font-semibold text-red-600"
                      : "bg-page text-muted"
                  }`}
                >
                  {due.overdue && !t.done ? "Overdue · " : ""}
                  {due.label}
                </span>
              ) : null}
              {t.platform ? <span className={chip}>{t.platform}</span> : null}
              {t.property ? <span className={chip}>🏠 {t.property}</span> : null}
              {t.tenant ? <span className={chip}>👤 {t.tenant}</span> : null}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void remove(t)}
          aria-label="Delete"
          className="shrink-0 rounded-md p-1 text-muted/50 transition hover:text-red-500"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" />
          </svg>
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="enter enter-up" style={enterAt(60)}>
        <h1 className="text-xl font-semibold tracking-tight">To-dos</h1>
        <p className="mt-1 text-[13px] text-muted">
          Your list, and the assistant&apos;s memory — ask it &ldquo;what do I need to
          do?&rdquo; and it checks here, or tell it to add and tick things off for you.
        </p>
      </div>

      {/* ---- add ---- */}
      <form
        className="enter enter-up card space-y-3 p-4"
        style={enterAt(140)}
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What needs doing? e.g. Chase EPC booking for Flat 3, 15 Marine Parade"
            className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-[14px] outline-none transition focus:border-black/25"
          />
          <button
            type="submit"
            disabled={saving || !note.trim()}
            className="btn-press shrink-0 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition disabled:opacity-40"
            style={{ background: BRAND.accent }}
          >
            Add
          </button>
        </div>

        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="text-[12px] font-medium text-muted underline decoration-dotted underline-offset-2 transition hover:text-ink"
        >
          {moreOpen ? "Hide details" : "Add date, platform, property or tenant"}
        </button>

        {moreOpen ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-[11px] font-medium text-muted">
              Due
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[13px] text-ink outline-none focus:border-black/25"
              />
            </label>
            <label className="block text-[11px] font-medium text-muted">
              Platform
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[13px] text-ink outline-none focus:border-black/25"
              >
                <option value="">None</option>
                {PLATFORM_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] font-medium text-muted">
              Property
              <input
                type="text"
                value={property}
                onChange={(e) => setProperty(e.target.value)}
                placeholder="e.g. Flat 3, 15 Marine Parade"
                className="mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[13px] outline-none focus:border-black/25"
              />
            </label>
            <label className="block text-[11px] font-medium text-muted">
              Tenant
              <input
                type="text"
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                placeholder="e.g. Michael Blackmore"
                className="mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[13px] outline-none focus:border-black/25"
              />
            </label>
          </div>
        ) : null}
      </form>

      {/* ---- list ---- */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card h-16 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="card p-6 text-center text-sm text-muted">{error}</div>
      ) : open.length === 0 && done.length === 0 ? (
        <div className="enter enter-up card p-10 text-center text-[13px] text-muted" style={enterAt(220)}>
          Nothing on the list. Add one above — or just tell the assistant on your
          dashboard and it&apos;ll pop up here.
        </div>
      ) : (
        <>
          <ul className="enter enter-up space-y-2" style={enterAt(220)}>
            {open.map((t) => (
              <TodoRow key={t.id} t={t} />
            ))}
            {open.length === 0 ? (
              <li className="card p-6 text-center text-[13px] text-muted">
                All caught up — nothing open. 🎉
              </li>
            ) : null}
          </ul>

          {done.length > 0 ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                className="text-[12px] font-medium text-muted underline decoration-dotted underline-offset-2 transition hover:text-ink"
              >
                {showDone ? `Hide ${done.length} done` : `Show ${done.length} done`}
              </button>
              {showDone ? (
                <ul className="space-y-2">
                  {done.map((t) => (
                    <TodoRow key={t.id} t={t} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
