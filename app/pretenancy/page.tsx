"use client";

// /pretenancy — Kirstie's move-in board (the pre-tenancy half of the duo
// admin login). A kanban of every live deal across ALL TLE agents: one
// column per stage, little card piles (address · tenant · agent) that scale
// to hundreds of move-ins a month. Clicking a card opens a near-full-screen
// workspace panel from the left — the CRM view: progression, checklist,
// tenant contacts and the full two-way notes thread with the agent, all
// visible without digging.
//
// Auth flow mirrors /admin: refreshUser → inline login if signed out →
// locked card unless PRETENANCY_EMAILS (or admin — Susan can look in).

import { useCallback, useEffect, useMemo, useState } from "react";
import BrandMark from "@/components/BrandMark";
import PasswordInput from "@/components/PasswordInput";
import { NotesThread } from "@/components/DealNotes";
import { getUser, logIn, refreshUser, signOut } from "@/lib/session";
import { BRAND } from "@/lib/brand";
import { formatGBP } from "@/lib/format";
import {
  CHECKLIST_ITEMS,
  PROPOLY_APP_URL,
  PROPOLY_STAGES,
  PROPOLY_STAGE_BY_KEY,
} from "@/lib/propoly-stages";
import type {
  DealEmail,
  DealMeta,
  DealNote,
  DealPortalOverlay,
  DealTask,
  MailboxStatus,
  UserProfile,
} from "@/lib/types";
import type { AgentApplication } from "@/lib/rex-stats";

/* ------------------------------- data shapes ------------------------------- */

interface BoardDeal {
  app: AgentApplication;
  statusKey: string;
  effectiveStatusKey: string;
  agentName: string | null;
  agentEmail: string | null;
  portal: DealPortalOverlay;
}

interface BoardSummary {
  pipelineTotal: number;
  byStage: { key: string; label: string; count: number }[];
  overdue: number;
  undated: number;
  completedMtd: number | null;
  forecastByMonth: Record<string, number> | null;
}

const enterAt = (ms: number) =>
  ({ "--enter-delay": `${ms}ms` }) as React.CSSProperties;

const STAGE_PILL: Record<string, string> = {
  start_deal: "border-line bg-page text-muted",
  holding_fee: "border-amber-200 bg-amber-50 text-amber-700",
  references: "border-sky-200 bg-sky-50 text-sky-700",
  tenancy_generation: "border-indigo-200 bg-indigo-50 text-indigo-700",
  signing_and_move_in_monies: "border-green-200 bg-green-50 text-green-700",
  cancelled: "border-line bg-page text-muted",
};

// Thin accent along the top of each kanban column, matched to the pill hues.
const STAGE_BAR: Record<string, string> = {
  start_deal: "bg-gray-300",
  holding_fee: "bg-amber-400",
  references: "bg-sky-400",
  tenancy_generation: "bg-indigo-400",
  signing_and_move_in_monies: "bg-green-500",
  cancelled: "bg-gray-300",
};

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

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

function stagePill(key: string): string {
  return STAGE_PILL[key] ?? "border-line bg-page text-muted";
}

function stageLabel(key: string): string {
  return PROPOLY_STAGE_BY_KEY[key]?.label ?? key.replace(/_/g, " ");
}

const today = () => new Date().toISOString().slice(0, 10);

function isOverdue(d: BoardDeal): boolean {
  return (
    d.statusKey !== "cancelled" &&
    d.app.startDate != null &&
    d.app.startDate < today()
  );
}

/* --------------------------------- page --------------------------------- */

export default function PreTenancyPage() {
  const [user, setUser] = useState<UserProfile | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const cached = getUser();
    if (cached) setUser(cached);
    void refreshUser().then((fresh) => {
      if (!cancelled) setUser(fresh);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setUser(null);
  }, []);

  if (user === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Checking your session…</p>
      </main>
    );
  }

  if (user === null) return <PreTenancyLogin onLoggedIn={setUser} />;

  if (!user.isPreTenancy && !user.isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="card w-full max-w-md p-8 text-center">
          <BrandMark size={44} className="mx-auto" />
          <h1 className="mt-4 text-lg font-semibold">
            This area is for the pre-tenancy team.
          </h1>
          <p className="mt-2 text-sm text-muted">
            You&apos;re signed in as {user.email}, which doesn&apos;t have
            pre-tenancy access. Your own pipeline lives on your dashboard.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <a
              href="/dashboard"
              className="btn-press rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
            >
              Go to my dashboard
            </a>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="btn-press rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium"
            >
              Sign out
            </button>
          </div>
        </div>
      </main>
    );
  }

  return <Board user={user} onSignOut={handleSignOut} />;
}

/* ----------------------------- inline login ----------------------------- */

function PreTenancyLogin({ onLoggedIn }: { onLoggedIn: (u: UserProfile) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLoggedIn(await logIn(email.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign you in.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-10 flex items-center justify-center gap-2.5">
          <BrandMark size={32} />
          <span className="text-sm font-semibold text-ink">{BRAND.name}</span>
        </div>
        <h1 className="text-center text-2xl font-semibold tracking-tight text-ink">
          Pre-tenancy sign in
        </h1>
        <p className="mt-2 text-center text-sm text-muted">
          The move-in board for the pre-tenancy team
        </p>
        <input
          autoFocus
          type="email"
          className="mt-8 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-gray-400"
          placeholder={`you@${BRAND.domains[0]}`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className="mt-3">
          <PasswordInput placeholder="Password" value={password} onChange={setPassword} />
        </div>
        {error && <p className="mt-3 text-sm text-accent">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="btn-press mt-4 w-full rounded-xl bg-accent py-3 text-sm font-medium text-white transition hover:bg-accent-dark disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

/* --------------------------------- board --------------------------------- */

function Board({ user, onSignOut }: { user: UserProfile; onSignOut: () => void }) {
  const [deals, setDeals] = useState<BoardDeal[] | null>(null);
  const [summary, setSummary] = useState<BoardSummary | null>(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [agent, setAgent] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [mailboxOpen, setMailboxOpen] = useState(false);
  const [tasksTodayOpen, setTasksTodayOpen] = useState(false);
  const [todayCount, setTodayCount] = useState<number | null>(null);

  // "Tasks today" badge count — refreshed whenever the modal closes too,
  // so ticking things off updates the header straight away.
  const refreshTodayCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/my/deal-tasks?due=${today()}`, { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { tasks: DealTask[] };
      setTodayCount(d.tasks.filter((t) => !t.done).length);
    } catch {
      // badge is decoration — ignore
    }
  }, []);

  useEffect(() => {
    void refreshTodayCount();
  }, [refreshTodayCount]);

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/pretenancy/deals", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const d = (await res.json()) as {
        configured: boolean;
        deals: BoardDeal[] | null;
        summary: BoardSummary | null;
      };
      setConfigured(d.configured);
      if (d.configured && d.deals == null) {
        // Propoly cache still warming (first hit after a deploy) — keep the
        // skeletons up and let the retry loop try again shortly.
        return false;
      }
      setDeals(d.deals ?? []);
      setSummary(d.summary);
      setError(null);
      return true;
    } catch {
      setError("Couldn't load the deal board — try a refresh in a minute.");
      return true; // hard error — stop retrying, the message is up
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      const settled = await load();
      // Gentle: Propoly rate-limits aggressively, so poll sparingly.
      if (!cancelled && !settled && attempts++ < 8) setTimeout(tick, 15_000);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [load]);

  /** Patch one deal's overlay/effective stage in place after a panel action. */
  const patchDeal = useCallback((id: string, patch: Partial<BoardDeal>) => {
    setDeals((prev) =>
      prev ? prev.map((d) => (d.app.id === id ? { ...d, ...patch } : d)) : prev
    );
  }, []);

  const agents = useMemo(() => {
    const names = new Set<string>();
    for (const d of deals ?? []) if (d.agentName) names.add(d.agentName);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [deals]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (deals ?? [])
      .filter((d) => d.agentName === agent || agent === "all")
      .filter((d) => !overdueOnly || isOverdue(d))
      .filter((d) => {
        if (!needle) return true;
        const hay = [
          d.app.propertyName,
          d.app.locality,
          d.agentName ?? "",
          ...d.app.tenants.map((tn) => tn.name),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(needle);
      });
  }, [deals, q, agent, overdueOnly]);

  // Column layout: one pile per stage; slipped move-ins float to the top of
  // their pile, then soonest move-in first.
  const columns = useMemo(() => {
    const keys = PROPOLY_STAGES.map((s) => s.key);
    if (showCancelled) keys.push("cancelled");
    return keys.map((key) => ({
      key,
      label: key === "cancelled" ? "Cancelled" : stageLabel(key),
      deals: filtered
        .filter((d) =>
          key === "cancelled" ? d.statusKey === "cancelled" : d.statusKey !== "cancelled" && d.effectiveStatusKey === key
        )
        .sort((a, b) => {
          const oa = isOverdue(a) ? 0 : 1;
          const ob = isOverdue(b) ? 0 : 1;
          if (oa !== ob) return oa - ob;
          return (a.app.startDate ?? "9999").localeCompare(b.app.startDate ?? "9999");
        }),
    }));
  }, [filtered, showCancelled]);

  const open = openId ? (deals ?? []).find((d) => d.app.id === openId) ?? null : null;

  return (
    <main className="flex min-h-screen flex-col bg-page">
      {/* ---- header ---- */}
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <BrandMark size={28} />
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold leading-tight">
              Pre-Tenancy
            </h1>
            <p className="text-[11px] leading-tight text-muted">
              Every move-in, every agent, one board
            </p>
          </div>

          {/* headline counters live in the header — the board needs the space */}
          {summary ? (
            <div className="ml-6 hidden items-center gap-5 lg:flex">
              <HeaderStat label="In progression" value={summary.pipelineTotal} />
              <HeaderStat label="Moved in this month" value={summary.completedMtd ?? "—"} />
              <button
                type="button"
                onClick={() => setOverdueOnly((v) => !v)}
                className={`btn-press rounded-lg border px-3 py-1.5 text-left transition ${
                  overdueOnly
                    ? "border-red-300 bg-red-50"
                    : "border-transparent hover:border-line"
                }`}
              >
                <div className={`stat-value text-[17px] leading-5 ${summary.overdue > 0 ? "text-red-600" : ""}`}>
                  {summary.overdue}
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Date slipped
                </div>
              </button>
              <HeaderStat label="No date" value={summary.undated} />
            </div>
          ) : null}

          <div className="ml-auto flex items-center gap-3">
            {user.isAdmin ? (
              <a
                href="/admin"
                className="hidden text-[12px] font-medium text-muted underline-offset-2 hover:underline sm:block"
              >
                Admin dashboard
              </a>
            ) : null}

            {/* today's date + her worklist for the day */}
            <div className="hidden items-center gap-2 sm:flex">
              <span className="text-[12px] text-muted">
                {new Date().toLocaleDateString("en-GB", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </span>
              <button
                type="button"
                onClick={() => setTasksTodayOpen(true)}
                className={`btn-press rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition ${
                  todayCount ? "border-red-200 bg-red-50 text-red-700" : "border-line bg-card"
                }`}
              >
                Tasks today{todayCount != null ? ` · ${todayCount}` : ""}
              </button>
            </div>

            <ProfileMenu
              user={user}
              onOpenMailbox={() => setMailboxOpen(true)}
              onSignOut={onSignOut}
            />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-4 pt-4 sm:px-6">
        {!configured ? (
          <div className="card p-6 text-sm text-muted">
            Propoly isn&apos;t connected yet — the deal board appears as soon as the
            integration keys are in place.
          </div>
        ) : null}
        {error ? <div className="card p-6 text-sm text-muted">{error}</div> : null}

        {/* ---- filters ---- */}
        <section className="enter enter-up flex flex-wrap items-center gap-2" style={enterAt(40)}>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search property, tenant or agent…"
            className="w-full max-w-xs rounded-xl border border-line bg-white px-3.5 py-2 text-[13px] outline-none transition focus:border-gray-400"
          />
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className="rounded-xl border border-line bg-white px-3 py-2 text-[13px] outline-none"
          >
            <option value="all">All agents</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-line accent-[#E31F36]"
            />
            Date slipped only
          </label>
          <label className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={(e) => setShowCancelled(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-line accent-[#E31F36]"
            />
            Show cancelled
          </label>
          <span className="ml-auto text-[12px] text-muted">
            {deals ? `${filtered.length} deal${filtered.length === 1 ? "" : "s"}` : ""}
          </span>
        </section>

        {/* ---- kanban ---- */}
        <section className="enter enter-up mt-4 min-h-0 flex-1" style={enterAt(100)}>
          {deals == null && !error ? (
            <div className="flex gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-[60vh] flex-1 animate-pulse rounded-2xl bg-white/70" />
              ))}
            </div>
          ) : (
            <div className="flex h-full gap-3 overflow-x-auto pb-6">
              {columns.map((col) => (
                <div
                  key={col.key}
                  className="flex w-60 shrink-0 flex-col rounded-2xl bg-black/[0.03] lg:w-auto lg:flex-1"
                >
                  <div className={`h-1 rounded-t-2xl ${STAGE_BAR[col.key] ?? "bg-gray-300"}`} />
                  <div className="flex items-baseline justify-between px-3 pb-2 pt-2.5">
                    <h2 className="text-[12px] font-semibold text-ink">{col.label}</h2>
                    <span className="text-[11px] font-medium text-muted">{col.deals.length}</span>
                  </div>
                  <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
                    {col.deals.map((d) => (
                      <DealCard key={d.app.id} d={d} onOpen={() => setOpenId(d.app.id)} />
                    ))}
                    {col.deals.length === 0 ? (
                      <p className="px-2 py-6 text-center text-[11px] text-muted">Nothing here</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {open ? (
        <DealWorkspace
          deal={open}
          onClose={() => {
            setOpenId(null);
            void refreshTodayCount();
          }}
          onPatched={(patch) => patchDeal(open.app.id, patch)}
          onOpenMailbox={() => setMailboxOpen(true)}
        />
      ) : null}

      {mailboxOpen ? (
        <MailboxModal user={user} onClose={() => setMailboxOpen(false)} />
      ) : null}
      {tasksTodayOpen ? (
        <TasksTodayModal
          onClose={() => {
            setTasksTodayOpen(false);
            void refreshTodayCount();
          }}
          onOpenDeal={(dealId) => {
            setTasksTodayOpen(false);
            setOpenId(dealId);
          }}
        />
      ) : null}
    </main>
  );
}

function HeaderStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="stat-value text-[17px] leading-5">{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

/* ------------------------------- deal card ------------------------------- */
// Deliberately tiny — these pile up to hundreds a month. Address, tenant,
// agent; the column already says the stage. Everything else is in the panel.

function DealCard({ d, onOpen }: { d: BoardDeal; onOpen: () => void }) {
  const lead = d.app.tenants.find((t) => t.isPrimary) ?? d.app.tenants[0];
  const overdue = isOverdue(d);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="btn-press w-full rounded-xl border border-line bg-white p-2.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:border-black/20"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[12.5px] font-semibold leading-snug">
          {d.app.propertyName}
        </p>
        {d.portal.notesCount > 0 ? (
          <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-muted">
            <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {d.portal.notesCount}
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 truncate text-[11px] text-muted">
        {lead ? lead.name : "No tenant recorded"}
        {d.app.tenants.length > 1 ? ` +${d.app.tenants.length - 1}` : ""}
      </p>
      <p className="truncate text-[11px] text-muted">{d.agentName ?? "—"}</p>
      {overdue ? (
        <p className="mt-1 text-[10px] font-semibold text-red-600">
          Move-in {fmtDate(d.app.startDate)} · slipped
        </p>
      ) : null}
    </button>
  );
}

/* ------------------------------ workspace panel ------------------------------ */
// The CRM view: slides out from the left and takes ~85% of the screen.
// Three working columns — the deal itself, the progression + checklist,
// and the notes thread at full height so nothing needs digging out.

function DealWorkspace({
  deal,
  onClose,
  onPatched,
  onOpenMailbox,
}: {
  deal: BoardDeal;
  onClose: () => void;
  onPatched: (patch: Partial<BoardDeal>) => void;
  onOpenMailbox: () => void;
}) {
  const [notes, setNotes] = useState<DealNote[] | null>(null);
  const [privateNotes, setPrivateNotes] = useState<DealNote[] | null>(null);
  const [meta, setMeta] = useState<DealMeta | null>(null);
  const [effective, setEffective] = useState(deal.effectiveStatusKey);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fetchNotes = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/deals/${deal.app.id}/notes`, { cache: "no-store" });
      if (!res.ok) return false;
      const d = (await res.json()) as {
        notes?: DealNote[];
        privateNotes?: DealNote[];
        meta?: DealMeta;
        effectiveStatusKey?: string;
      };
      setNotes(d.notes ?? []);
      setPrivateNotes(d.privateNotes ?? []);
      setMeta(d.meta ?? null);
      if (d.effectiveStatusKey) setEffective(d.effectiveStatusKey);
      return true;
    } catch {
      return false;
    }
  }, [deal.app.id]);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    // Retry a couple of times — right after a deploy the Propoly cache can
    // still be warming, and the route answers 503 until it's ready.
    const tick = async () => {
      const ok = await fetchNotes();
      if (cancelled) return;
      if (!ok && attempts++ < 5) {
        setTimeout(tick, 4000);
      } else if (!ok) {
        setNotes([]);
        setPrivateNotes([]);
      }
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [fetchNotes]);

  /** Push a fresh meta + effective stage into the panel AND the board card. */
  function applyMeta(m: DealMeta, eff: string) {
    setMeta(m);
    setEffective(eff);
    const done = CHECKLIST_ITEMS.filter((i) => m.checklist[i.key]?.done).length;
    onPatched({
      effectiveStatusKey: eff,
      portal: {
        ...deal.portal,
        override:
          m.stageOverride && eff !== deal.statusKey
            ? { stageKey: m.stageOverride, by: m.stageBy ?? "", at: m.stageAt ?? "" }
            : null,
        checklistDone: done,
        checklistTotal: CHECKLIST_ITEMS.length,
      },
    });
  }

  async function postMeta(body: Record<string, unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/deals/${deal.app.id}/meta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json()) as {
        meta?: DealMeta;
        effectiveStatusKey?: string;
        error?: string;
      };
      if (!res.ok || !d.meta) throw new Error(d.error ?? "That didn't save.");
      applyMeta(d.meta, d.effectiveStatusKey ?? deal.statusKey);
      void fetchNotes(); // pick up the auto-logged activity line
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "That didn't save.");
    } finally {
      setBusy(false);
    }
  }

  /** Post a shared activity note or a private one; returns success. */
  async function sendNote(text: string, kind: "note" | "private"): Promise<boolean> {
    if (!text.trim() || busy) return false;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/deals/${deal.app.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), kind }),
      });
      const d = (await res.json()) as { note?: DealNote; error?: string };
      if (!res.ok || !d.note) throw new Error(d.error ?? "Couldn't add the note.");
      if (kind === "private") {
        setPrivateNotes((prev) => [...(prev ?? []), d.note!]);
        return true;
      }
      const next = [...(notes ?? []), d.note];
      setNotes(next);
      // Card badge counts the human conversation only, not system lines.
      const humanCount = next.filter((n) => (n.kind ?? "note") === "note").length;
      onPatched({
        portal: {
          ...deal.portal,
          notesCount: humanCount,
          lastNote: {
            text: d.note.text,
            authorName: d.note.authorName,
            authorRole: d.note.authorRole,
            at: d.note.createdAt,
          },
        },
      });
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Couldn't add the note.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const cancelled = deal.statusKey === "cancelled";
  const p = deal.app.propoly;
  const currentIdx = PROPOLY_STAGES.findIndex((s) => s.key === effective);
  const moved = effective !== deal.statusKey;
  const checklistDone = meta
    ? CHECKLIST_ITEMS.filter((i) => meta.checklist[i.key]?.done).length
    : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose}>
      <div
        className="panel-slide fixed inset-y-0 left-0 flex w-full max-w-[85vw] flex-col bg-page shadow-2xl lg:w-[85vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---- panel header ---- */}
        <div className="flex items-center gap-4 border-b border-line bg-white px-5 py-4 sm:px-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${stagePill(cancelled ? "cancelled" : effective)}`}>
                {(cancelled ? "Cancelled" : stageLabel(effective)).toUpperCase()}
              </span>
              {p?.service ? (
                <span className="rounded-full border border-line bg-page px-2 py-0.5 text-[9px] font-semibold text-muted">
                  {p.service.toUpperCase()}
                </span>
              ) : null}
            </div>
            <h2 className="mt-1.5 truncate text-[19px] font-semibold leading-snug">
              {deal.app.propertyName}
            </h2>
            <p className="truncate text-[13px] text-muted">
              {deal.app.locality}
              {deal.agentName ? ` · ${deal.agentName}` : ""}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <a
              href={PROPOLY_APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-press hidden rounded-lg border border-line bg-card px-3.5 py-2 text-[12px] font-semibold sm:block"
            >
              Open in Propoly ↗
            </a>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-full border border-line p-2 text-muted transition hover:text-ink"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        {/* ---- banners ---- */}
        {(moved && meta?.stageBy) || actionError || cancelled ? (
          <div className="space-y-2 px-5 pt-4 sm:px-8">
            {cancelled ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[12px] text-red-700">
                This deal was cancelled before completion.
              </p>
            ) : null}
            {moved && meta?.stageBy ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-800">
                Moved to <span className="font-semibold">{stageLabel(effective)}</span> by{" "}
                {meta.stageBy}
                {meta.stageAt ? ` · ${fmtDateTime(meta.stageAt)}` : ""} — Propoly itself still
                shows {stageLabel(deal.statusKey)}.
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void postMeta({ stage: null })}
                  className="ml-2 font-semibold underline underline-offset-2"
                >
                  Reset to live
                </button>
              </p>
            ) : null}
            {actionError ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[12px] text-red-700">
                {actionError}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* ---- three working columns ---- */}
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 sm:p-8 lg:grid-cols-12 lg:overflow-hidden">
          {/* -- the deal -- */}
          <div className="min-h-0 space-y-4 lg:col-span-3 lg:overflow-y-auto lg:pr-1">
            <div className="card p-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                The numbers
              </h3>
              <dl className="mt-3 space-y-3">
                <NumberRow label="Rent / month" value={deal.app.offer != null ? formatGBP(deal.app.offer) : "—"} big />
                <NumberRow label="Deposit" value={p?.deposit != null ? formatGBP(p.deposit) : "—"} />
                <NumberRow label="Holding fee" value={p?.holdingFee != null ? formatGBP(p.holdingFee) : "—"} />
                <NumberRow
                  label="Move-in date"
                  value={fmtDate(deal.app.startDate) ?? "TBC"}
                  alert={isOverdue(deal)}
                />
                <NumberRow label="Deal received" value={fmtDate(deal.app.dateReceived) ?? "—"} />
                {deal.app.hasPets ? <NumberRow label="Pets" value="Yes" /> : null}
              </dl>
            </div>

            <div className="card p-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {deal.app.tenants.length === 1
                  ? "Tenant"
                  : `Tenants (${deal.app.tenants.length})`}
              </h3>
              <div className="mt-3 space-y-2.5">
                {deal.app.tenants.length ? (
                  deal.app.tenants.map((t, i) => (
                    <div key={i} className="rounded-xl border border-line px-3.5 py-2.5">
                      <p className="text-[13px] font-medium">
                        {t.name}
                        {t.isPrimary ? (
                          <span className="ml-2 rounded-full border border-line bg-page px-1.5 py-0.5 text-[9px] font-semibold text-muted">
                            LEAD
                          </span>
                        ) : null}
                      </p>
                      <div className="mt-0.5 space-y-0.5 text-[12px] text-muted">
                        {t.email ? (
                          <a href={`mailto:${t.email}`} className="block truncate hover:text-ink">
                            {t.email}
                          </a>
                        ) : null}
                        {t.phone ? (
                          <a href={`tel:${t.phone}`} className="block hover:text-ink">
                            {t.phone}
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-[13px] text-muted">No tenant details recorded yet.</p>
                )}
              </div>
            </div>

            <div className="card p-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Agent
              </h3>
              <p className="mt-2 text-[13px] font-medium">{deal.agentName ?? "Unassigned"}</p>
              {deal.agentEmail ? (
                <a
                  href={`mailto:${deal.agentEmail}`}
                  className="block truncate text-[12px] text-muted hover:text-ink"
                >
                  {deal.agentEmail}
                </a>
              ) : null}
            </div>
          </div>

          {/* -- progression + checklist -- */}
          <div className="min-h-0 space-y-4 lg:col-span-4 lg:overflow-y-auto lg:pr-1">
            <div className="card p-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Progression
              </h3>
              <ol className="mt-4">
                {PROPOLY_STAGES.map((s, i) => {
                  const state = cancelled
                    ? "off"
                    : i < currentIdx
                      ? "done"
                      : i === currentIdx
                        ? "current"
                        : "todo";
                  const last = i === PROPOLY_STAGES.length - 1;
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
                        <p className={`text-[13.5px] font-medium leading-6 ${state === "todo" || state === "off" ? "text-muted" : "text-ink"}`}>
                          {s.label}
                          {state === "current" && !cancelled ? (
                            <span className="ml-2 rounded-full accent-soft-bg px-2 py-0.5 text-[9px] font-semibold accent-text">
                              NOW
                            </span>
                          ) : null}
                        </p>
                        {state === "current" ? (
                          <p className="mt-0.5 text-[12px] text-muted">{s.blurb}</p>
                        ) : null}
                        {!cancelled && state !== "current" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void postMeta({ stage: s.key })}
                            className="mt-0.5 text-[11px] font-medium text-muted underline decoration-dotted underline-offset-2 transition hover:text-ink disabled:opacity-50"
                          >
                            Move here
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="card p-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Pre-tenancy checklist
                <span className="ml-2 font-normal normal-case text-muted">
                  {checklistDone}/{CHECKLIST_ITEMS.length} done
                </span>
              </h3>
              <div className="mt-3 space-y-1">
                {CHECKLIST_ITEMS.map((item) => {
                  const tick = meta?.checklist[item.key];
                  return (
                    <label
                      key={item.key}
                      className="flex cursor-pointer select-none items-start gap-3 rounded-lg px-2 py-1.5 transition hover:bg-page"
                    >
                      <input
                        type="checkbox"
                        checked={tick?.done ?? false}
                        disabled={busy || meta == null}
                        onChange={(e) =>
                          void postMeta({ checklist: { key: item.key, done: e.target.checked } })
                        }
                        className="mt-0.5 h-4 w-4 rounded border-line accent-[#E31F36]"
                      />
                      <span className="text-[13px] leading-5">
                        <span className={tick?.done ? "text-muted line-through" : ""}>
                          {item.label}
                        </span>
                        {tick?.done ? (
                          <span className="ml-1.5 text-[10px] text-muted">
                            {tick.by.split(" ")[0]} · {fmtDate(tick.at)}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* -- the working tabs: activity, emails, private notes, tasks -- */}
          <div className="flex min-h-0 flex-col lg:col-span-5">
            <WorkTabs
              deal={deal}
              notes={notes}
              privateNotes={privateNotes}
              busy={busy}
              onSend={sendNote}
              onOpenMailbox={onOpenMailbox}
              onActivityChanged={() => void fetchNotes()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function NumberRow({
  label,
  value,
  big = false,
  alert = false,
}: {
  label: string;
  value: string;
  big?: boolean;
  alert?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd
        className={`${big ? "stat-value text-[18px]" : "text-[13px] font-medium"} ${
          alert ? "text-red-600" : "text-ink"
        }`}
      >
        {value}
        {alert ? " · slipped" : ""}
      </dd>
    </div>
  );
}

/* ------------------------------ work tabs ------------------------------ */
// Activity (everyone sees) · Emails (from her connected mailbox) ·
// Notes (private, only the author) · Tasks (follow-ups with dates).

type WorkTab = "activity" | "emails" | "notes" | "tasks";

function WorkTabs({
  deal,
  notes,
  privateNotes,
  busy,
  onSend,
  onOpenMailbox,
  onActivityChanged,
}: {
  deal: BoardDeal;
  notes: DealNote[] | null;
  privateNotes: DealNote[] | null;
  busy: boolean;
  onSend: (text: string, kind: "note" | "private") => Promise<boolean>;
  onOpenMailbox: () => void;
  onActivityChanged: () => void;
}) {
  const [tab, setTab] = useState<WorkTab>("activity");

  const tabs: { key: WorkTab; label: string }[] = [
    { key: "activity", label: "Activity" },
    { key: "emails", label: "Emails" },
    { key: "notes", label: "Notes" },
    { key: "tasks", label: "Tasks" },
  ];

  return (
    <div className="card flex min-h-0 flex-1 flex-col">
      <div className="flex border-b border-line px-2 pt-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`relative px-3.5 py-2.5 text-[12.5px] font-semibold transition ${
              tab === t.key ? "text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {tab === t.key ? (
              <span
                className="absolute inset-x-3 bottom-0 h-0.5 rounded-full"
                style={{ background: BRAND.accent }}
              />
            ) : null}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        {tab === "activity" ? (
          <>
            <div className="min-h-0 flex-1">
              <NotesThread notes={notes} maxHeightClass="max-h-full lg:h-[calc(100%-8px)]" />
            </div>
            <Composer
              busy={busy}
              placeholder={`Message ${deal.agentName ? deal.agentName.split(" ")[0] : "the agent"} — they see it instantly…`}
              onSend={(text) => onSend(text, "note")}
            />
          </>
        ) : tab === "emails" ? (
          <EmailsTab deal={deal} onOpenMailbox={onOpenMailbox} />
        ) : tab === "notes" ? (
          <>
            <p className="rounded-lg bg-page px-3 py-1.5 text-[11px] text-muted">
              Personal notes — nobody else can see these, not even the agent.
            </p>
            <div className="min-h-0 flex-1">
              <NotesThread
                notes={privateNotes}
                maxHeightClass="max-h-full lg:h-[calc(100%-8px)]"
              />
            </div>
            <Composer
              busy={busy}
              placeholder="Add a private note — just for you…"
              onSend={(text) => onSend(text, "private")}
            />
          </>
        ) : (
          <TasksTab deal={deal} onActivityChanged={onActivityChanged} />
        )}
      </div>
    </div>
  );
}

function Composer({
  busy,
  placeholder,
  onSend,
}: {
  busy: boolean;
  placeholder: string;
  onSend: (text: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");

  async function submit() {
    if (!draft.trim()) return;
    if (await onSend(draft)) setDraft("");
  }

  return (
    <div className="mt-3 flex gap-2 border-t border-line pt-3">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] outline-none transition focus:border-gray-400"
      />
      <button
        type="button"
        disabled={busy || !draft.trim()}
        onClick={() => void submit()}
        className="btn-press shrink-0 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition disabled:opacity-50"
        style={{ background: BRAND.accent }}
      >
        Send
      </button>
    </div>
  );
}

/* -------------------------------- emails -------------------------------- */

function EmailsTab({ deal, onOpenMailbox }: { deal: BoardDeal; onOpenMailbox: () => void }) {
  const [state, setState] = useState<{
    loading: boolean;
    connected: boolean;
    noAddresses?: boolean;
    error?: string;
    emails: DealEmail[];
  }>({ loading: true, connected: true, emails: [] });
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${deal.app.id}/emails`, { cache: "no-store" })
      .then((r) => r.json())
      .then(
        (d: {
          connected?: boolean;
          emails?: DealEmail[];
          noAddresses?: boolean;
          error?: string;
        }) => {
          if (cancelled) return;
          setState({
            loading: false,
            connected: d.connected !== false,
            noAddresses: d.noAddresses,
            error: d.error,
            emails: d.emails ?? [],
          });
        }
      )
      .catch(
        () =>
          !cancelled &&
          setState({
            loading: false,
            connected: true,
            error: "Couldn't load emails just now.",
            emails: [],
          })
      );
    return () => {
      cancelled = true;
    };
  }, [deal.app.id]);

  if (state.loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-xl bg-page" />
        ))}
        <p className="pt-1 text-center text-[11px] text-muted">
          Checking your mailbox for tenant emails…
        </p>
      </div>
    );
  }

  if (!state.connected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="max-w-xs text-[13px] text-muted">
          Connect your email to see every message to and from this deal&apos;s
          tenants, logged right here for the records.
        </p>
        <button
          type="button"
          onClick={onOpenMailbox}
          className="btn-press rounded-lg px-4 py-2 text-[13px] font-semibold text-white"
          style={{ background: BRAND.accent }}
        >
          Connect your email
        </button>
      </div>
    );
  }

  if (state.error) {
    return <p className="rounded-xl bg-page px-4 py-3 text-[12px] text-muted">{state.error}</p>;
  }

  if (state.noAddresses) {
    return (
      <p className="rounded-xl bg-page px-4 py-3 text-[12px] text-muted">
        No tenant email addresses on this deal yet, so there&apos;s nothing to match
        against your mailbox.
      </p>
    );
  }

  if (state.emails.length === 0) {
    return (
      <p className="rounded-xl bg-page px-4 py-3 text-[12px] text-muted">
        No emails with {deal.app.tenants.map((t) => t.name.split(" ")[0]).join(" or ")} in
        the last 90 days.
      </p>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
      {state.emails.map((e) => {
        const open = openId === e.id;
        return (
          <div key={e.id} className="rounded-xl border border-line">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : e.id)}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
            >
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                  e.direction === "in"
                    ? "bg-sky-50 text-sky-700"
                    : "bg-green-50 text-green-700"
                }`}
              >
                {e.direction === "in" ? "IN" : "SENT"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{e.subject}</span>
                <span className="block truncate text-[11px] text-muted">
                  {e.direction === "in" ? e.from : `To ${e.to}`}
                </span>
              </span>
              <span className="shrink-0 text-[10px] text-muted">
                {e.date ? fmtDateTime(e.date) : ""}
              </span>
            </button>
            {open ? (
              <div className="border-t border-line px-3.5 py-3">
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">
                  {e.body || "No readable text in this email."}
                </p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------- tasks -------------------------------- */

/** "Add to calendar" — a one-event ICS file the browser downloads. */
function downloadIcs(task: DealTask) {
  const day = (task.dueDate ?? new Date().toISOString().slice(0, 10)).replace(/-/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const esc = (s: string) => s.replace(/([,;\\])/g, "\\$1");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TLE Portal//Pre-Tenancy//EN",
    "BEGIN:VEVENT",
    `UID:${task.id}@tle-portal`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${day}`,
    `SUMMARY:${esc(task.title)} — ${esc(task.dealLabel)}`,
    `DESCRIPTION:${esc(`Pre-tenancy follow-up for ${task.dealLabel} (TLE portal)`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `follow-up-${day}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

function TasksTab({
  deal,
  onActivityChanged,
}: {
  deal: BoardDeal;
  onActivityChanged: () => void;
}) {
  const [tasks, setTasks] = useState<DealTask[] | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deals/${deal.app.id}/tasks`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { tasks?: DealTask[] }) => !cancelled && setTasks(d.tasks ?? []))
      .catch(() => !cancelled && setTasks([]));
    return () => {
      cancelled = true;
    };
  }, [deal.app.id]);

  async function add() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${deal.app.id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), dueDate: due || null }),
      });
      const d = (await res.json()) as { task?: DealTask; error?: string };
      if (!res.ok || !d.task) throw new Error(d.error ?? "Couldn't add the follow-up.");
      setTasks((prev) => [...(prev ?? []), d.task!]);
      setTitle("");
      onActivityChanged(); // the follow-up is logged as an activity line
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the follow-up.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(task: DealTask, done: boolean) {
    setTasks((prev) =>
      prev ? prev.map((t) => (t.id === task.id ? { ...t, done } : t)) : prev
    );
    try {
      await fetch("/api/my/deal-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, done }),
      });
    } catch {
      // revert on failure
      setTasks((prev) =>
        prev ? prev.map((t) => (t.id === task.id ? { ...t, done: !done } : t)) : prev
      );
    }
  }

  const overdueDay = today();

  return (
    <>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {tasks == null ? (
          <div className="h-16 animate-pulse rounded-xl bg-page" />
        ) : tasks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-3.5 py-3 text-[12px] text-muted">
            No follow-ups on this deal yet. Set one below — it shows under
            &quot;Tasks today&quot; when the day comes.
          </p>
        ) : (
          tasks.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2.5 rounded-xl border border-line px-3.5 py-2.5"
            >
              <input
                type="checkbox"
                checked={t.done}
                onChange={(e) => void toggle(t, e.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-line accent-[#E31F36]"
              />
              <div className="min-w-0 flex-1">
                <p className={`truncate text-[13px] ${t.done ? "text-muted line-through" : "font-medium"}`}>
                  {t.title}
                </p>
                {t.dueDate ? (
                  <p
                    className={`text-[11px] ${
                      !t.done && t.dueDate < overdueDay
                        ? "font-semibold text-red-600"
                        : "text-muted"
                    }`}
                  >
                    Due {fmtDate(t.dueDate)}
                    {!t.done && t.dueDate < overdueDay ? " · overdue" : ""}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => downloadIcs(t)}
                title="Add to calendar"
                className="btn-press shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-medium text-muted transition hover:text-ink"
              >
                Add to calendar
              </button>
            </div>
          ))
        )}
      </div>

      {error ? <p className="mt-2 text-[12px] text-accent">{error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
          placeholder="Add a follow-up — e.g. Chase references…"
          className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] outline-none transition focus:border-gray-400"
        />
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="rounded-xl border border-line bg-white px-3 py-2 text-[13px] text-muted outline-none"
        />
        <button
          type="button"
          disabled={busy || !title.trim()}
          onClick={() => void add()}
          className="btn-press shrink-0 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition disabled:opacity-50"
          style={{ background: BRAND.accent }}
        >
          Add
        </button>
      </div>
    </>
  );
}

/* ------------------------------ tasks today ------------------------------ */

function TasksTodayModal({
  onClose,
  onOpenDeal,
}: {
  onClose: () => void;
  onOpenDeal: (dealId: string) => void;
}) {
  const [tasks, setTasks] = useState<DealTask[] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/my/deal-tasks?due=${today()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { tasks?: DealTask[] }) => !cancelled && setTasks(d.tasks ?? []))
      .catch(() => !cancelled && setTasks([]));
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(task: DealTask, done: boolean) {
    setTasks((prev) =>
      prev ? prev.map((t) => (t.id === task.id ? { ...t, done } : t)) : prev
    );
    try {
      await fetch("/api/my/deal-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, done }),
      });
    } catch {
      setTasks((prev) =>
        prev ? prev.map((t) => (t.id === task.id ? { ...t, done: !done } : t)) : prev
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-20"
      onClick={onClose}
    >
      <div
        className="modal-pop w-full max-w-lg rounded-2xl bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">
            Tasks today ·{" "}
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-line p-1.5 text-muted transition hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="mt-4 space-y-1.5">
          {tasks == null ? (
            <div className="h-16 animate-pulse rounded-xl bg-page" />
          ) : tasks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
              Nothing due today. Set follow-ups from any deal&apos;s Tasks tab.
            </p>
          ) : (
            tasks.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2.5 rounded-xl border border-line px-3.5 py-2.5"
              >
                <input
                  type="checkbox"
                  checked={t.done}
                  onChange={(e) => void toggle(t, e.target.checked)}
                  className="h-4 w-4 shrink-0 rounded border-line accent-[#E31F36]"
                />
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-[13px] ${t.done ? "text-muted line-through" : "font-medium"}`}>
                    {t.title}
                  </p>
                  <p className="truncate text-[11px] text-muted">{t.dealLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenDeal(t.dealId)}
                  className="btn-press shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-medium text-muted transition hover:text-ink"
                >
                  Open deal
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------- profile menu + mailbox ------------------------- */

function ProfileMenu({
  user,
  onOpenMailbox,
  onSignOut,
}: {
  user: UserProfile;
  onOpenMailbox: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-press flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] font-medium"
      >
        {user.name}
        <svg viewBox="0 0 24 24" className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="menu-pop absolute right-0 z-50 mt-1.5 w-52 rounded-xl border border-line bg-card p-1.5 shadow-lg">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenMailbox();
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-[12.5px] font-medium transition hover:bg-page"
            >
              Profile &amp; email
              <span className="block text-[10.5px] font-normal text-muted">
                Connect your mailbox for the Emails tab
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-[12.5px] font-medium transition hover:bg-page"
            >
              Sign out
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

const MAIL_PRESETS: { key: string; label: string; host: string }[] = [
  { key: "google", label: "Google Workspace / Gmail", host: "imap.gmail.com" },
  { key: "m365", label: "Microsoft 365 / Outlook", host: "outlook.office365.com" },
  { key: "other", label: "Other (enter server)", host: "" },
];

function MailboxModal({ user, onClose }: { user: UserProfile; onClose: () => void }) {
  const [status, setStatus] = useState<MailboxStatus | null>(null);
  const [email, setEmail] = useState(user.email);
  const [preset, setPreset] = useState("google");
  const [host, setHost] = useState("imap.gmail.com");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/mailbox", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: MailboxStatus) => !cancelled && setStatus(d))
      .catch(() => !cancelled && setStatus({ connected: false }));
    return () => {
      cancelled = true;
    };
  }, []);

  function pickPreset(key: string) {
    setPreset(key);
    const p = MAIL_PRESETS.find((x) => x.key === key);
    if (p && p.host) setHost(p.host);
    if (p && !p.host) setHost("");
  }

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/mailbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, imapHost: host.trim() }),
      });
      const d = (await res.json()) as { error?: string; connected?: boolean; imapHost?: string };
      if (!res.ok) throw new Error(d.error ?? "Couldn't connect.");
      setStatus({ connected: true, email: email.trim(), imapHost: host.trim() });
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/me/mailbox", { method: "DELETE" });
      setStatus({ connected: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-20"
      onClick={onClose}
    >
      <div
        className="modal-pop w-full max-w-md rounded-2xl bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Profile &amp; email</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-line p-1.5 text-muted transition hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <p className="mt-1.5 text-[12px] text-muted">
          Signed in as <span className="font-medium text-ink">{user.email}</span>
        </p>

        <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Email connection
        </h3>

        {status == null ? (
          <div className="mt-3 h-16 animate-pulse rounded-xl bg-page" />
        ) : status.connected ? (
          <div className="mt-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-[13px] font-medium text-green-800">
              Connected — {status.email}
            </p>
            <p className="mt-0.5 text-[11px] text-green-700">
              Emails to and from a deal&apos;s tenants now appear on its Emails tab.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void disconnect()}
              className="mt-2 text-[12px] font-semibold text-green-800 underline underline-offset-2"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-2.5">
            <p className="text-[12px] text-muted">
              Sign in with an <span className="font-medium text-ink">app password</span>{" "}
              (not your normal password) — in Gmail: Google Account → Security →
              2-Step Verification → App passwords.
            </p>
            <select
              value={preset}
              onChange={(e) => pickPreset(e.target.value)}
              className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] outline-none"
            >
              {MAIL_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            {preset === "other" ? (
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="IMAP server, e.g. imap.yourhost.co.uk"
                className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] outline-none transition focus:border-gray-400"
              />
            ) : null}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[13px] outline-none transition focus:border-gray-400"
            />
            <PasswordInput placeholder="App password" value={password} onChange={setPassword} />
            {error ? <p className="text-[12px] text-accent">{error}</p> : null}
            <button
              type="button"
              disabled={busy || !email.trim() || !password || !host.trim()}
              onClick={() => void connect()}
              className="btn-press w-full rounded-xl bg-accent py-2.5 text-[13px] font-semibold text-white transition hover:bg-accent-dark disabled:opacity-50"
            >
              {busy ? "Checking the sign-in…" : "Connect email"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
