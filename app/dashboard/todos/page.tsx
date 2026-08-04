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
import DateTimePicker from "@/components/DateTimePicker";
import DoodleIcon from "@/components/DoodleIcon";
import Loader from "@/components/Loader";

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

interface Suggestion {
  note: string;
  property?: string | null;
  why?: string | null;
}

/** Bucket an open to-do for the summary strip and the All-tasks filter. */
function bucketOf(t: Todo): "overdue" | "today" | "upcoming" | "nodate" {
  if (!t.dueAt) return "nodate";
  const d = new Date(t.dueAt);
  if (Number.isNaN(d.getTime())) return "nodate";
  const now = new Date();
  if (d.getTime() < now.getTime()) return "overdue";
  return d.toDateString() === now.toDateString() ? "today" : "upcoming";
}

/** Tiny swing-down dropdown in the period-pill style. */
function PillMenu({
  icon,
  label,
  options,
  value,
  onChange,
}: {
  icon: string;
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onChange: (k: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const close = () => {
    setOpen(false);
    setClosing(true);
    window.setTimeout(() => setClosing(false), 240);
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const active = options.find((o) => o.key === value);
  const off = value === options[0]?.key;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        // Hairline pill, same as the controls on My Properties. The 1.5px inked
        // frame belongs to .dash-cards .card — on a control this small it read
        // as a heavier, darker line than anything else on the page.
        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-medium transition ${
          off && !open
            ? "border-line bg-transparent text-muted hover:border-black/25 hover:text-ink"
            : "border-line bg-black/[0.04] text-ink"
        }`}
      >
        <DoodleIcon name={icon} size={15} />
        {off ? label : (active?.label ?? label)}
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden style={{ transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }}>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open || closing ? (
        <div className={`${closing ? "shrink-up" : "swing-down"} absolute right-0 top-full z-30 mt-1.5 min-w-[180px] overflow-hidden rounded-xl border border-line bg-card p-1 shadow-lg`}>
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                onChange(o.key);
                close();
              }}
              className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-[13px] text-ink transition hover:bg-page"
            >
              {o.label}
              {value === o.key ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3 8.5l3.5 3.5L13 5" stroke="#e31f36" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
    // Four fields in a square — due date, platform, property, tenant.
    <div className="grid gap-2.5 sm:grid-cols-2">
      <div className="text-[11px] font-medium text-muted">
        Due
        <div className="mt-1">
          <DateTimePicker value={d.dueAt} onChange={(dueAt) => onChange({ dueAt })} />
        </div>
      </div>
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

// How long the completion celebration runs before the tile leaves the list.
// Deliberately unhurried — this is the one moment the page gets to be silly.
const CELEBRATION_MS = 4900;


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

  // The tile currently playing its completion celebration (id → started at).
  const [celebrating, setCelebrating] = useState<string | null>(null);

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

  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [taskFilter, setTaskFilter] = useState("all");
  const [sortBy, setSortBy] = useState("due");

  // Calendar export. The portal has no scheduler, so it can't email anyone in
  // eleven months — but a calendar can. The .ics carries its own alarms
  // (30/14/7/1 days before), so the reminding happens in Outlook or Google.
  // "Email me a copy" sends NOW with the .ics attached, for adding it from a
  // phone; it is not a subscription to future emails.
  const [emailCopy, setEmailCopy] = useState(false);
  const [calBusy, setCalBusy] = useState<string | null>(null);
  const [calFlash, setCalFlash] = useState<{ id: string; text: string; bad?: boolean } | null>(null);

  const open = useMemo(() => {
    let list = todos.filter((t) => !t.done);
    if (taskFilter !== "all") list = list.filter((t) => bucketOf(t) === taskFilter);
    if (sortBy === "due") {
      list = [...list].sort((a, b) => {
        if (!a.dueAt && !b.dueAt) return 0;
        if (!a.dueAt) return 1;
        if (!b.dueAt) return -1;
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      });
    }
    return list;
  }, [todos, taskFilter, sortBy]);
  const allOpen = useMemo(() => todos.filter((t) => !t.done), [todos]);
  const done = useMemo(() => todos.filter((t) => t.done), [todos]);

  async function loadSuggestions() {
    if (suggesting) return;
    setSuggesting(true);
    setSuggestOpen(true);
    setSuggestError(null);
    try {
      const res = await fetch("/api/my/todo-suggestions", { cache: "no-store" });
      const data = (await res.json()) as { suggestions?: Suggestion[]; error?: string };
      if (!res.ok) setSuggestError(data.error ?? "Couldn't put suggestions together.");
      else setSuggestions(data.suggestions ?? []);
    } catch {
      setSuggestError("Couldn't put suggestions together.");
    } finally {
      setSuggesting(false);
    }
  }

  /** Accept one suggestion straight onto the list. */
  async function addSuggestion(s: Suggestion) {
    setSuggestions((prev) => prev.filter((x) => x.note !== s.note));
    try {
      const res = await fetch("/api/my/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: s.note, property: s.property || null }),
      });
      const data = (await res.json()) as { todo?: Todo };
      if (res.ok && data.todo) setTodos((prev) => [data.todo!, ...prev]);
    } catch {
      /* it stays off the list; they can hit Suggest again */
    }
  }

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
    // Un-ticking is instant; ticking gets the full song and dance first.
    if (t.done) {
      setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: false } : x)));
      const res = await fetch("/api/my/todos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, done: false }),
      });
      if (!res.ok) {
        setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: true } : x)));
      }
      return;
    }

    if (celebrating) return;
    setCelebrating(t.id);

    // Save straight away; the animation plays over the top either way.
    const res = await fetch("/api/my/todos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id, done: true }),
    });

    // Total run: spin → tick → confetti → liftoff → scoot → collapse.
    setTimeout(() => {
      if (res.ok) {
        setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: true } : x)));
      }
      setCelebrating(null);
    }, CELEBRATION_MS);
  }

  async function remove(t: Todo) {
    setTodos((prev) => prev.filter((x) => x.id !== t.id));
    await fetch(`/api/my/todos?id=${encodeURIComponent(t.id)}`, { method: "DELETE" });
  }

  // Change just the date from the tile's chip — saves straight away.
  /**
   * Download the to-do as a calendar event, and optionally email a copy.
   * Fetched as a blob rather than navigated to, so a 400 ("give it a date
   * first") surfaces as a message instead of downloading the error JSON.
   */
  async function addToCalendar(t: Todo) {
    if (calBusy) return;
    setCalBusy(t.id);
    setCalFlash(null);
    try {
      const res = await fetch(`/api/my/todos/ics?id=${encodeURIComponent(t.id)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setCalFlash({ id: t.id, text: body?.error ?? "Couldn't build that event.", bad: true });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${t.note.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "reminder"}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      if (!emailCopy) {
        setCalFlash({ id: t.id, text: "Added — open the file to drop it in your calendar." });
        return;
      }

      const mail = await fetch("/api/my/todos/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id }),
      });
      const mailBody = (await mail.json().catch(() => null)) as
        | { error?: string; sentTo?: string }
        | null;
      if (!mail.ok) {
        // The download already worked — say so, rather than reading as a total failure.
        setCalFlash({
          id: t.id,
          text: `Downloaded, but the email didn't send. ${mailBody?.error ?? ""}`.trim(),
          bad: true,
        });
        return;
      }
      setCalFlash({ id: t.id, text: `Downloaded, and emailed to ${mailBody?.sentTo ?? "you"}.` });
    } catch {
      setCalFlash({ id: t.id, text: "Couldn't do that just now.", bad: true });
    } finally {
      setCalBusy(null);
    }
  }

  async function patchDue(t: Todo, dueAt: string) {
    const next = dueAt || null;
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, dueAt: next } : x)));
    const res = await fetch("/api/my/todos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id, dueAt: next }),
    });
    if (!res.ok) {
      setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, dueAt: t.dueAt } : x)));
    }
  }

  const chip = "inline-flex items-center gap-1 rounded-full bg-page px-2 py-0.5 text-[11px] text-muted";

  // A to-do is a tile. Click it to open it up (the tile stretches to the full
  // row and the detail square morphs in); the date chip is the calendar —
  // click it and pick, no edit mode needed.
  const TodoTile = ({ t }: { t: Todo }) => {
    const due = fmtDue(t.dueAt);
    const editing = editId === t.id;

    if (editing) {
      return (
        <li className="menu-pop col-span-full space-y-3 rounded-xl border border-line p-4">
          <input
            type="text"
            value={editNote}
            onChange={(e) => setEditNote(e.target.value)}
            autoFocus
            className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[14px] outline-none transition focus:border-black/25"
          />
          <DetailFields d={editDetails} onChange={(p) => setEditDetails((v) => ({ ...v, ...p }))} />

          {/* Calendar: the reminder lives in Outlook/Google, not here — the
              portal has nothing running at 6am to send it. */}
          <div className="rounded-lg border border-line bg-page/60 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void addToCalendar(t)}
                disabled={!editDetails.dueAt || calBusy === t.id}
                title={editDetails.dueAt ? undefined : "Give it a date first"}
                className="btn-press inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-[12px] font-semibold text-ink transition hover:border-black/25 disabled:opacity-40"
              >
                <DoodleIcon name="calendar" size={13} className="shrink-0 text-muted/70" />
                {calBusy === t.id ? "Working…" : "Add to calendar"}
              </button>
              <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-muted">
                <input
                  type="checkbox"
                  checked={emailCopy}
                  onChange={(e) => setEmailCopy(e.target.checked)}
                  className="h-3.5 w-3.5 accent-black"
                />
                Email me a copy
              </label>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              {editDetails.dueAt
                ? "Reminds you 30, 14, 7 and 1 days before — from your own calendar."
                : "Set a date above and this becomes a calendar reminder."}
            </p>
            {calFlash?.id === t.id ? (
              <p className={`mt-1.5 text-[11px] ${calFlash.bad ? "text-red-600" : "text-ink"}`}>
                {calFlash.text}
              </p>
            ) : null}
          </div>

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
            <button
              type="button"
              onClick={() => void remove(t)}
              className="btn-press ml-auto rounded-lg border border-line px-3.5 py-2 text-[13px] font-medium text-muted transition hover:border-red-200 hover:text-red-600"
            >
              Delete
            </button>
          </div>
        </li>
      );
    }

    const party = celebrating === t.id;

    return (
      // A one-row grid so the completion animation can collapse it smoothly
      // (grid-template-rows 1fr → 0fr); the card padding lives on the inner
      // wrapper so it shrinks away with everything else.
      <li
        className={`group card card-flat relative grid min-h-0 cursor-pointer grid-rows-[1fr] overflow-hidden text-left transition hover:border-black/20 ${
          party ? "done-collapse" : ""
        }`}
        onClick={() => !party && startEdit(t)}
        role="button"
        tabIndex={0}
        // Only the tile itself: the done button and the date chip stop click
        // propagation, but key events still bubble, so without this Enter on
        // "Mark as done" would open the editor too.
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          if (!party) startEdit(t);
        }}
      >
        <div className="overflow-hidden">
        <div className="flex h-full flex-col p-4">
        {/* everything that flies away when the job's done */}
        <div className={party ? "done-liftoff" : ""}>
          {/* the title, on its own line */}
          <p className={`text-[14px] font-medium leading-snug ${t.done ? "text-muted line-through" : "text-ink"}`}>
            {t.note}
          </p>

          {/* the details, one thing per line so it reads rather than jumbles */}
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center gap-2 text-[12px] text-muted" onClick={(e) => e.stopPropagation()}>
              <DoodleIcon name="calendar" size={13} className="shrink-0 text-muted/70" />
              <DateTimePicker
                value={isoToLocal(t.dueAt)}
                onChange={(v) => void patchDue(t, v)}
                variant="chip"
                overdue={Boolean(due?.overdue && !t.done)}
                placeholder="Add a date"
              />
            </div>
            {t.property ? (
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <DoodleIcon name="home" size={13} className="shrink-0 text-muted/70" />
                <span className="truncate text-ink">{t.property}</span>
              </div>
            ) : null}
            {t.tenant || t.platform ? (
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <DoodleIcon name={t.tenant ? "user" : "grid"} size={13} className="shrink-0 text-muted/70" />
                <span className="truncate text-ink">{t.tenant ?? t.platform}</span>
                {t.tenant && t.platform ? <span className={chip}>{t.platform}</span> : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* Mark as done — the only button on the tile; deleting lives behind
            the click-through so nothing goes missing by accident. */}
        <div className={`mt-auto flex flex-wrap items-center gap-2 pt-4 ${party ? "done-liftoff" : ""}`}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void toggle(t);
            }}
            disabled={Boolean(celebrating) && !party}
            className={`btn-press inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition ${
              t.done
                ? "border-line text-muted hover:text-ink"
                : "border-line text-ink hover:border-black/25"
            }`}
          >
            <span
              className={`relative flex h-4 w-4 items-center justify-center rounded-full border ${
                t.done || party ? "border-transparent" : "border-line"
              }`}
              style={t.done || party ? { background: BRAND.accent } : undefined}
            >
              {party ? (
                <>
                  <span className="done-spin absolute inset-0 rounded-full border-2 border-white/70 border-t-transparent" />
                  <svg viewBox="0 0 24 24" className="done-tick h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </>
              ) : t.done ? (
                <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : null}
            </span>
            {t.done ? "Done" : party ? "Nice one!" : "Mark as done"}
          </button>

          {/* Quick calendar export — only worth offering once it has a date. */}
          {t.dueAt && !t.done ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void addToCalendar(t);
              }}
              disabled={calBusy === t.id}
              title="Add to calendar"
              aria-label={`Add "${t.note}" to calendar`}
              className="btn-press inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-muted transition hover:border-black/25 hover:text-ink disabled:opacity-40"
            >
              <DoodleIcon name="calendar" size={13} className="shrink-0" />
              {calBusy === t.id ? "…" : "Calendar"}
            </button>
          ) : null}
          {calFlash?.id === t.id ? (
            <p className={`basis-full text-[11px] ${calFlash.bad ? "text-red-600" : "text-muted"}`}>
              {calFlash.text}
            </p>
          ) : null}
        </div>
        </div>
        </div>

        {/* ---- the Fast Worker scoots through on his chair, clipped to the
             tile and facing the way he's travelling ---- */}
        {party ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-24 overflow-hidden">
            <div className="done-scoot absolute bottom-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/illustrations/notioly/fast-worker.svg"
                alt=""
                aria-hidden
                className="h-24 w-auto -scale-x-100"
              />
            </div>
          </div>
        ) : null}
      </li>
    );
  };

  const BUCKETS = [
    { key: "overdue", label: "Overdue", icon: "clock", chip: "bg-red-100 text-red-700" },
    { key: "today", label: "Due today", icon: "star", chip: "bg-amber-100 text-amber-700" },
    { key: "upcoming", label: "Upcoming", icon: "calendar", chip: "bg-sky-100 text-sky-700" },
    { key: "nodate", label: "No due date", icon: "target", chip: "bg-black/[0.06] text-muted" },
  ] as const;

  return (
    <div className="outline-cards space-y-6">
      {/* ---- hero: title + add form left, the list lady right ---- */}
      <div className="relative">
        <div className="enter enter-up" style={enterAt(60)}>
          <h1 className="tracking-tight" style={{ fontSize: "clamp(30px, 3vw, 40px)", fontWeight: 500 }}>
            To-dos
          </h1>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted">
            Your list, and the assistant&apos;s memory — ask it &ldquo;what do I need to
            do?&rdquo; and it checks here, or tell it to add and tick things off for you.
          </p>
        </div>
      </div>

      {/* ---- add ---- */}
      <form
        className="enter enter-up max-w-2xl space-y-3"
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
            // Just a ruled line to write on, like a pad.
            className="w-full border-0 border-b-[1.5px] border-ink/25 bg-transparent px-1 py-2.5 text-[14px] outline-none transition focus:border-ink/70"
          />
          <button
            type="button"
            onClick={() => (suggestOpen ? setSuggestOpen(false) : void loadSuggestions())}
            className={`btn-press inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-2.5 text-[13px] font-medium transition ${
              suggestOpen
                ? "border-line bg-black/[0.04] text-ink"
                : "border-line text-muted hover:border-black/25 hover:text-ink"
            }`}
          >
            <DoodleIcon name="magic-wand" size={15} className="text-accent" />
            Suggest
          </button>
          <button
            type="submit"
            disabled={saving || !note.trim()}
            className="btn-press shrink-0 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition disabled:opacity-40"
            style={{ background: BRAND.accent }}
          >
            Add
          </button>
        </div>

        {/* What the assistant reckons is outstanding — accept the ones you want. */}
        {suggestOpen ? (
          <div className="swing-down rounded-2xl border border-line bg-card p-3">
            {suggesting ? (
              <p className="px-1 py-2 text-[12.5px] text-muted">
                Reading your compliance and properties…
              </p>
            ) : suggestError ? (
              <p className="px-1 py-2 text-[12.5px] text-muted">{suggestError}</p>
            ) : suggestions.length === 0 ? (
              <p className="px-1 py-2 text-[12.5px] text-muted">
                Nothing outstanding worth chasing — you&rsquo;re on top of it.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {suggestions.map((s) => (
                  <li
                    key={s.note}
                    className="flex items-start gap-3 rounded-xl px-2 py-2 transition hover:bg-page"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-ink">{s.note}</p>
                      {s.why ? <p className="mt-0.5 text-[11.5px] text-muted">{s.why}</p> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void addSuggestion(s)}
                      className="btn-press shrink-0 rounded-full border border-line px-3 py-1 text-[12px] font-semibold text-ink transition hover:border-black/30"
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="text-[12px] font-medium text-muted underline decoration-dotted underline-offset-2 transition hover:text-ink"
        >
          {moreOpen ? "Hide details" : "Add date, platform, property or tenant"}
        </button>

        {/* Morphs open — the row heights animate rather than the panel jumping in. */}
        <div
          className={`grid transition-all duration-300 ease-out ${
            moreOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="pt-1">
              <DetailFields d={details} onChange={(p) => setDetails((v) => ({ ...v, ...p }))} />
            </div>
          </div>
        </div>
      </form>

      {/* ---- filters, right-hand side like the reference ---- */}
      <div className="enter enter-up flex justify-end gap-2" style={enterAt(180)}>
        <PillMenu
          icon="list"
          label="All tasks"
          options={[
            { key: "all", label: "All tasks" },
            { key: "overdue", label: "Overdue" },
            { key: "today", label: "Due today" },
            { key: "upcoming", label: "Upcoming" },
            { key: "nodate", label: "No due date" },
          ]}
          value={taskFilter}
          onChange={setTaskFilter}
        />
        <PillMenu
          icon="calendar"
          label="By due date"
          options={[
            { key: "due", label: "By due date" },
            { key: "added", label: "Recently added" },
          ]}
          value={sortBy}
          onChange={setSortBy}
        />
      </div>

      {/* ---- summary strip: the four buckets ---- */}
      <div className="enter enter-up card grid grid-cols-2 gap-y-5 p-5 lg:grid-cols-4 lg:divide-x lg:divide-line lg:gap-y-0" style={enterAt(200)}>
        {BUCKETS.map((b) => {
          const items = allOpen.filter((t) => bucketOf(t) === b.key);
          return (
            <div key={b.key} className="min-w-0 lg:px-5 lg:first:pl-0 lg:last:pr-0">
              <div className="flex items-center gap-2">
                <DoodleIcon name={b.icon} size={15} className="text-ink" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink">{b.label}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold tnum ${b.chip}`}>
                  {items.length}
                </span>
              </div>
              <div className="mt-3 h-[3px] w-6 rounded-full bg-ink" />
              <div className="mt-3 space-y-1 text-[12.5px] text-muted">
                {items.length === 0 ? (
                  <p>Nothing here (yet)</p>
                ) : (
                  <>
                    {items.slice(0, 2).map((t) => (
                      <p key={t.id} className="truncate text-ink">{t.note}</p>
                    ))}
                    {items.length > 2 ? <p>+{items.length - 2} more</p> : null}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ---- list ---- */}
      {loading ? (
        <Loader label="Loading your list…" />
      ) : error ? (
        <div className="card p-6 text-center text-sm text-muted">{error}</div>
      ) : open.length === 0 && done.length === 0 ? (
        <div className="enter enter-up card p-10 text-center text-[13px] text-muted" style={enterAt(220)}>
          Nothing on the list. Add one above — or just tell the assistant on your
          dashboard and it&apos;ll pop up here.
        </div>
      ) : (
        <>
          <div className="enter enter-up card relative p-5 pb-8" style={enterAt(220)}>
            {open.length === 0 && allOpen.length > 0 ? (
              <div className="flex min-h-[180px] flex-col items-center justify-center py-8 text-center text-[13px] text-muted">
                Nothing matches that filter.
              </div>
            ) : open.length === 0 ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 py-8 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/illustrations/confetti.png" alt="" aria-hidden className="w-[150px]" />
                <p className="mt-3 text-[19px] font-semibold text-ink">All caught up — nothing open.</p>
                <p className="text-[13px] text-muted">Nice work! Enjoy the calm.</p>
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {open.map((t) => (
                  <TodoTile key={t.id} t={t} />
                ))}
              </ul>
            )}
            {/* the dog inspects the bottom-right corner — his solid paper fill
                hides the box line running behind him */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/illustrations/dog.png"
              alt=""
              aria-hidden
              className="pointer-events-none absolute -bottom-9 right-10 z-10 hidden w-[130px] lg:block"
            />
          </div>

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
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {done.map((t) => (
                    <TodoTile key={t.id} t={t} />
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
