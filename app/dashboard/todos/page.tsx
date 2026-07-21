"use client";

// To-dos — the agent's own reminder list. Anything they need to chase lives
// here: free-text note, optional due date/time, the platform it happens on,
// and the property/tenant it relates to. Property and tenant are smart
// pickers: as you type, the portal searches what it already knows about YOU
// — your live Propoly deals first, then your REX book — and offers matches
// (free text always allowed). The TLE Assistant reads this list when asked
// "what do I need to do?", and can add/complete items itself — both ends
// stay in sync through /api/my/todos.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

interface Suggestion {
  label: string;
  sub: string | null;
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

/** Close an open panel on outside click or Escape. */
function usePanelClose(open: boolean, ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, onClose]);
}

/* ------------------------------ BrandSelect ------------------------------ */

/** On-brand replacement for a native <select>: pill button, animated panel. */
function BrandSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  usePanelClose(open, ref, () => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-2.5 py-2 text-left text-[13px] outline-none transition ${
          open ? "border-black/25" : "border-line hover:border-black/20"
        }`}
      >
        <span className={value ? "text-ink" : "text-muted/70"}>{value || placeholder}</span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          className="menu-pop absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-xl border border-line bg-card p-1 shadow-xl"
        >
          <button
            type="button"
            role="option"
            aria-selected={!value}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-[13px] text-muted transition hover:bg-black/[0.04]"
          >
            None
          </button>
          {options.map((opt) => {
            const active = opt === value;
            return (
              <button
                key={opt}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] transition hover:bg-black/[0.04] ${
                  active ? "accent-soft-bg font-medium text-ink" : "text-ink"
                }`}
              >
                {opt}
                {active ? (
                  <svg className="h-3.5 w-3.5" fill="none" stroke={BRAND.accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ SuggestInput ----------------------------- */

/** Text input that offers the agent's own properties/tenants as they type. */
function SuggestInput({
  value,
  onChange,
  kind,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  kind: "property" | "tenant";
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  usePanelClose(open, ref, () => setOpen(false));

  const search = useCallback(
    (q: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const mySeq = ++seq.current;
        setSearching(true);
        try {
          const res = await fetch(
            `/api/my/todo-suggest?kind=${kind}&q=${encodeURIComponent(q)}`,
            { cache: "no-store" }
          );
          const data = (await res.json()) as { suggestions?: Suggestion[] };
          if (mySeq === seq.current) setSuggestions(data.suggestions ?? []);
        } catch {
          if (mySeq === seq.current) setSuggestions([]);
        } finally {
          if (mySeq === seq.current) setSearching(false);
        }
      }, 200);
    },
    [kind]
  );

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          search(e.target.value);
        }}
        onFocus={() => {
          setOpen(true);
          search(value);
        }}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[13px] outline-none transition focus:border-black/25"
      />
      {open && (suggestions.length > 0 || searching) ? (
        <div className="menu-pop absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-xl border border-line bg-card p-1 shadow-xl">
          {searching && suggestions.length === 0 ? (
            <div className="px-2.5 py-2 text-[12px] text-muted">Searching your properties…</div>
          ) : (
            suggestions.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => {
                  onChange(s.label);
                  setOpen(false);
                }}
                className="flex w-full flex-col rounded-lg px-2.5 py-2 text-left transition hover:bg-black/[0.04]"
              >
                <span className="text-[13px] text-ink">{s.label}</span>
                {s.sub ? <span className="text-[11px] text-muted">{s.sub}</span> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ detail fields ---------------------------- */

interface Details {
  dueAt: string;
  platform: string;
  property: string;
  tenant: string;
}

function DetailFields({
  d,
  onChange,
}: {
  d: Details;
  onChange: (patch: Partial<Details>) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <label className="block text-[11px] font-medium text-muted">
        Due
        <input
          type="datetime-local"
          value={d.dueAt}
          onChange={(e) => onChange({ dueAt: e.target.value })}
          className="mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[13px] text-ink outline-none focus:border-black/25"
        />
      </label>
      <div className="text-[11px] font-medium text-muted">
        Platform
        <div className="mt-1">
          <BrandSelect
            value={d.platform}
            onChange={(platform) => onChange({ platform })}
            options={PLATFORM_OPTIONS}
            placeholder="None"
          />
        </div>
      </div>
      <div className="text-[11px] font-medium text-muted">
        Property
        <div className="mt-1">
          <SuggestInput
            value={d.property}
            onChange={(property) => onChange({ property })}
            kind="property"
            placeholder="Start typing — we'll find it"
          />
        </div>
      </div>
      <div className="text-[11px] font-medium text-muted">
        Tenant
        <div className="mt-1">
          <SuggestInput
            value={d.tenant}
            onChange={(tenant) => onChange({ tenant })}
            kind="tenant"
            placeholder="Start typing — we'll find them"
          />
        </div>
      </div>
    </div>
  );
}

const EMPTY_DETAILS: Details = { dueAt: "", platform: "", property: "", tenant: "" };

/** ISO from the store → value a datetime-local input accepts. */
function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------------------------------- page --------------------------------- */

export default function TodosPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  // add form
  const [note, setNote] = useState("");
  const [details, setDetails] = useState<Details>(EMPTY_DETAILS);
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // edit-in-place
  const [editId, setEditId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [editDetails, setEditDetails] = useState<Details>(EMPTY_DETAILS);
  const [editSaving, setEditSaving] = useState(false);

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
          dueAt: details.dueAt || null,
          platform: details.platform || null,
          property: details.property || null,
          tenant: details.tenant || null,
        }),
      });
      const data = (await res.json()) as { todo?: Todo };
      if (res.ok && data.todo) {
        setTodos((prev) => [data.todo!, ...prev]);
        setNote("");
        setDetails(EMPTY_DETAILS);
        setMoreOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }

  function startEdit(t: Todo) {
    setEditId(t.id);
    setEditNote(t.note);
    setEditDetails({
      dueAt: isoToLocal(t.dueAt),
      platform: t.platform ?? "",
      property: t.property ?? "",
      tenant: t.tenant ?? "",
    });
  }

  async function saveEdit() {
    if (!editId || !editNote.trim() || editSaving) return;
    setEditSaving(true);
    try {
      const res = await fetch("/api/my/todos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editId,
          note: editNote,
          dueAt: editDetails.dueAt || null,
          platform: editDetails.platform || null,
          property: editDetails.property || null,
          tenant: editDetails.tenant || null,
        }),
      });
      const data = (await res.json()) as { todo?: Todo };
      if (res.ok && data.todo) {
        setTodos((prev) => prev.map((x) => (x.id === data.todo!.id ? data.todo! : x)));
        setEditId(null);
      }
    } finally {
      setEditSaving(false);
    }
  }

  async function toggle(t: Todo) {
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

    if (editId === t.id) {
      return (
        <li className="menu-pop space-y-3 rounded-xl border border-line bg-card p-3.5">
          <input
            type="text"
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[14px] outline-none transition focus:border-black/25"
          />
          <DetailFields d={editDetails} onChange={(p) => setEditDetails((v) => ({ ...v, ...p }))} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={editSaving || !editNote.trim()}
              className="btn-press rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white transition disabled:opacity-40"
              style={{ background: BRAND.accent }}
            >
              {editSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditId(null)}
              className="btn-press rounded-lg border border-line px-3.5 py-2 text-[13px] font-medium text-muted transition hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </li>
      );
    }

    return (
      <li className="group flex items-start gap-3 rounded-xl border border-line bg-card p-3.5">
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
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => startEdit(t)}
            aria-label="Edit"
            className="rounded-md p-1 text-muted/50 transition hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => void remove(t)}
            aria-label="Delete"
            className="rounded-md p-1 text-muted/50 transition hover:text-red-500"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" />
            </svg>
          </button>
        </div>
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
          <div className="menu-pop">
            <DetailFields d={details} onChange={(p) => setDetails((v) => ({ ...v, ...p }))} />
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
