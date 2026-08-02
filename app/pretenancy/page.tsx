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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BrandMark from "@/components/BrandMark";
import PasswordInput from "@/components/PasswordInput";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import { NotesThread } from "@/components/DealNotes";
import DoodleIcon from "@/components/DoodleIcon";
import { getUser, logIn, refreshUser, signOut } from "@/lib/session";
import { BRAND } from "@/lib/brand";
import { formatGBP } from "@/lib/format";
import {
  CHECKLIST_ITEMS,
  PROPOLY_APP_URL,
  PORTAL_STAGES,
  PORTAL_STAGE_BY_KEY,
  portalStageOf,
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
import { rexListingUrl } from "@/lib/rex-links";

/* ------------------------------- data shapes ------------------------------- */

interface BoardDeal {
  /** Move-in slipped 30+ days with nobody reactivating it. Kept out of the
   *  stage tabs entirely and gathered in Archive under the three-dot menu. */
  archived?: boolean;
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
  deal_started: "border-line bg-page text-muted",
  holding_fee: "border-amber-200 bg-amber-50 text-amber-700",
  referencing: "border-sky-200 bg-sky-50 text-sky-700",
  plc: "border-cyan-200 bg-cyan-50 text-cyan-700",
  deposit: "border-violet-200 bg-violet-50 text-violet-700",
  tenancy_agreement: "border-indigo-200 bg-indigo-50 text-indigo-700",
  rent_payment: "border-emerald-200 bg-emerald-50 text-emerald-700",
  move_day: "border-green-300 bg-green-50 text-green-800",
  cancelled: "border-line bg-page text-muted",
};

// Per-stage visual identity for the category row, tabs and tiles: a coloured
// icon chip (soft bg + icon colour) and a solid dot colour. Colour-coded so
// the eye can track a deal's stage at a glance.
interface StageVisual {
  iconBg: string;
  iconText: string;
  dot: string;
}
const STAGE_VISUAL: Record<string, StageVisual> = {
  deal_started: { iconBg: "bg-slate-100", iconText: "text-slate-600", dot: "bg-slate-400" },
  holding_fee: { iconBg: "bg-amber-100", iconText: "text-amber-600", dot: "bg-amber-400" },
  referencing: { iconBg: "bg-sky-100", iconText: "text-sky-600", dot: "bg-sky-400" },
  plc: { iconBg: "bg-cyan-100", iconText: "text-cyan-600", dot: "bg-cyan-400" },
  deposit: { iconBg: "bg-violet-100", iconText: "text-violet-600", dot: "bg-violet-400" },
  tenancy_agreement: { iconBg: "bg-indigo-100", iconText: "text-indigo-600", dot: "bg-indigo-400" },
  rent_payment: { iconBg: "bg-emerald-100", iconText: "text-emerald-600", dot: "bg-emerald-400" },
  move_day: { iconBg: "bg-green-100", iconText: "text-green-700", dot: "bg-green-500" },
  cancelled: { iconBg: "bg-gray-100", iconText: "text-gray-400", dot: "bg-gray-300" },
  all: { iconBg: "bg-slate-100", iconText: "text-slate-600", dot: "bg-slate-400" },
  slipped: { iconBg: "bg-red-100", iconText: "text-red-600", dot: "bg-red-500" },
};
function stageVisual(key: string): StageVisual {
  return STAGE_VISUAL[key] ?? STAGE_VISUAL.deal_started;
}

// One simple stroke icon per stage. `d` paths are drawn inside a 24-box.

/** Which doodle stands for each stage. Same hand-drawn pack the rest of the
 *  portal uses, so the board stops looking like a different product. */
const STAGE_DOODLE: Record<string, string> = {
  deal_started: "rocket",
  holding_fee: "coin",
  referencing: "search",
  plc: "shield",
  deposit: "bank",
  tenancy_agreement: "file-contract",
  rent_payment: "wallet",
  move_day: "key",
  slipped: "clock",
  all: "grid",
  cancelled: "cross",
};

function StageIcon({ stageKey, size = 16 }: { stageKey: string; size?: number; className?: string }) {
  return <DoodleIcon name={STAGE_DOODLE[stageKey] ?? "rocket"} size={size} />;
}

/* --------------------------- movement detection --------------------------- */
// Red = needs the pre-tenancy team's attention (an unanswered agent message,
// or a slipped move-in). Green = recent movement that's ticking along fine.
// Both are derived from data we already hold — no read-state to maintain.

const RECENT_DAYS = 5;
const AWAITING_DAYS = 14;

function daysSince(iso?: string | null): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Infinity : (Date.now() - t) / 86_400_000;
}

function dealNeedsAttention(d: BoardDeal): boolean {
  if (isOverdue(d)) return true;
  const ln = d.portal.lastNote;
  // The agent messaged and the ball is in pre-tenancy's court.
  return !!ln && ln.authorRole === "agent" && daysSince(ln.at) <= AWAITING_DAYS;
}

function dealHasUpdate(d: BoardDeal): boolean {
  if (dealNeedsAttention(d)) return false;
  const noteRecent = d.portal.lastNote != null && daysSince(d.portal.lastNote.at) <= RECENT_DAYS;
  const movedRecent = d.portal.override != null && daysSince(d.portal.override.at) <= RECENT_DAYS;
  return noteRecent || movedRecent;
}

/** "red" | "green" | null for a set of deals (red wins). */
function movementOf(deals: BoardDeal[]): "red" | "green" | null {
  let green = false;
  for (const d of deals) {
    if (dealNeedsAttention(d)) return "red";
    if (dealHasUpdate(d)) green = true;
  }
  return green ? "green" : null;
}

function MovementDot({ kind, className = "" }: { kind: "red" | "green" | null; className?: string }) {
  if (!kind) return null;
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${kind === "red" ? "bg-red-500" : "bg-green-500"} ${className}`}
      title={kind === "red" ? "Needs attention — unanswered message or slipped move-in" : "Recent movement"}
    />
  );
}

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
  return PORTAL_STAGE_BY_KEY[key]?.label ?? key.replace(/_/g, " ");
}

const today = () => new Date().toISOString().slice(0, 10);

function isOverdue(d: BoardDeal): boolean {
  return (
    d.statusKey !== "cancelled" &&
    d.app.startDate != null &&
    d.app.startDate < today()
  );
}

// Old lingering deals (move-in — or, if undated, created — before 2026) are
// hidden for now: they're mostly stale records that should have completed.
// We'll reconcile them once PayProp is connected.
function isFrom2025(d: BoardDeal): boolean {
  const ref = d.app.startDate ?? d.app.dateReceived;
  return ref != null && ref < "2026-01-01";
}

// The dot strip shows how far through the 8-stage pipeline a deal is: e.g.
// Referencing is the 3rd stage → 3 of 8 filled.
function stageProgress(key: string): { done: number; total: number } {
  const total = PORTAL_STAGES.length;
  const idx = PORTAL_STAGES.findIndex((s) => s.key === key);
  return { done: idx >= 0 ? idx + 1 : 0, total };
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
  const [showCancelled, setShowCancelled] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // Which stage tab is active. Always opens on the first stage.
  const [tab, setTab] = useState<string>("deal_started");
  const [moreOpen, setMoreOpen] = useState(false);
  // Board layout: focused tiles (one stage) or the full kanban.
  const [view, setView] = useState<"tiles" | "kanban">("tiles");
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

  // Base set: agent + search filters only. Stage is a TAB, not a filter.
  // 2025 deals are hidden for now (see isFrom2025).
  const base = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (deals ?? [])
      .filter((d) => !isFrom2025(d))
      .filter((d) => !d.archived)
      .filter((d) => d.agentName === agent || agent === "all")
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
  }, [deals, q, agent]);

  // Deals grouped by their effective stage (cancelled kept aside).
  const byStage = useMemo(() => {
    const m = new Map<string, BoardDeal[]>();
    for (const s of PORTAL_STAGES) m.set(s.key, []);
    const cancelled: BoardDeal[] = [];
    const slipped: BoardDeal[] = [];
    for (const d of base) {
      if (d.statusKey === "cancelled") {
        cancelled.push(d);
        continue;
      }
      if (isOverdue(d)) slipped.push(d);
      m.get(d.effectiveStatusKey)?.push(d);
    }
    return { byKey: m, cancelled, slipped };
  }, [base]);

  const activeCount = base.filter((d) => d.statusKey !== "cancelled").length;
  const undatedCount = base.filter(
    (d) => d.statusKey !== "cancelled" && d.app.startDate == null
  ).length;

  // Tabs: All + each stage + Slipped (+ Cancelled when toggled). Each carries
  // a count and a movement dot so you can see where there's action.
  const tabs = useMemo(() => {
    const sortDeals = (arr: BoardDeal[]) =>
      [...arr].sort((a, b) => {
        const oa = isOverdue(a) ? 0 : 1;
        const ob = isOverdue(b) ? 0 : 1;
        if (oa !== ob) return oa - ob;
        return (a.app.startDate ?? "9999").localeCompare(b.app.startDate ?? "9999");
      });
    const list: { key: string; label: string; deals: BoardDeal[]; movement: "red" | "green" | null }[] = [];
    // Stages first (always open on the first), then Slipped, then All, then
    // Cancelled when toggled.
    for (const s of PORTAL_STAGES) {
      const dl = byStage.byKey.get(s.key) ?? [];
      list.push({ key: s.key, label: s.label, deals: sortDeals(dl), movement: movementOf(dl) });
    }
    list.push({ key: "slipped", label: "Slipped", deals: sortDeals(byStage.slipped), movement: byStage.slipped.length ? "red" : null });
    const allActive = base.filter((d) => d.statusKey !== "cancelled");
    list.push({ key: "all", label: "All", deals: sortDeals(allActive), movement: movementOf(allActive) });
    // Archive is built from the RAW list, not `base` — base filters archived
    // deals out, which is the whole point of it.
    const archived = (deals ?? [])
      .filter((d) => d.archived)
      .filter((d) => d.agentName === agent || agent === "all");
    list.push({ key: "archive", label: "Archive", deals: sortDeals(archived), movement: null });
    if (showCancelled) {
      list.push({ key: "cancelled", label: "Cancelled", deals: byStage.cancelled, movement: null });
    }
    return list;
  }, [base, byStage, showCancelled, deals, agent]);

  const activeTab = tabs.find((t) => t.key === tab) ?? tabs[0];
  const open = openId ? (deals ?? []).find((d) => d.app.id === openId) ?? null : null;

  return (
    <main className="type-admin flex min-h-screen flex-col bg-page">
      {/* ---- header ---- */}
      <header className="sticky top-0 z-30 border-b border-line bg-page/90 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <WorkspaceSwitcher user={user} current="pretenancy" size={28} />

          <div className="ml-auto flex items-center gap-3">
            {/* Tasks moved to the dock, bottom right — the header is just
                the brand and her profile now. */}
            <div className="hidden items-center gap-2 sm:flex">
            </div>

            <ProfileMenu
              user={user}
              onOpenMailbox={() => setMailboxOpen(true)}
              onSignOut={onSignOut}
            />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-5 pt-4 sm:px-8">
        {!configured ? (
          <div className="card p-6 text-sm text-muted">
            Propoly isn&apos;t connected yet — the deal board appears as soon as the
            integration keys are in place.
          </div>
        ) : null}
        {error ? <div className="card p-6 text-sm text-muted">{error}</div> : null}

        {/* ---- everything below the header rule: the figures and filters
             first, then the stage rail with the deals beside it ---- */}
        <div className="mt-5 flex min-h-0 flex-1 flex-col border-t border-line pt-5">
          <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {deals ? (
              <div className="flex items-center gap-6">
                <MiniStat label="In progression" value={activeCount} />
                <MiniStat label="Moved in this month" value={summary?.completedMtd ?? "—"} />
                <MiniStat label="No date" value={undatedCount} />
              </div>
            ) : null}
            {/* tiles ↔ kanban flick toggle */}
            {deals ? (
              <div className="flex items-center rounded-xl border border-line p-0.5">
                <button
                  type="button"
                  onClick={() => setView("tiles")}
                  title="Tile view"
                  className={`btn-press flex h-8 w-8 items-center justify-center rounded-lg transition ${
                    view === "tiles" ? "bg-page text-ink shadow-sm" : "text-muted hover:text-ink"
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                    <rect x={3} y={3} width={7} height={7} rx={1.5} />
                    <rect x={14} y={3} width={7} height={7} rx={1.5} />
                    <rect x={3} y={14} width={7} height={7} rx={1.5} />
                    <rect x={14} y={14} width={7} height={7} rx={1.5} />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setView("kanban")}
                  title="Board view"
                  className={`btn-press flex h-8 w-8 items-center justify-center rounded-lg transition ${
                    view === "kanban" ? "bg-page text-ink shadow-sm" : "text-muted hover:text-ink"
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                    <rect x={3} y={4} width={5} height={16} rx={1.5} />
                    <rect x={9.5} y={4} width={5} height={11} rx={1.5} />
                    <rect x={16} y={4} width={5} height={14} rx={1.5} />
                  </svg>
                </button>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search property, tenant or agent…"
                className="w-52 rounded-xl border border-line bg-transparent px-3.5 py-2 text-[13px] outline-none transition focus:border-black/30"
              />
              <select
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                className="rounded-xl border border-line bg-transparent px-3 py-2 text-[13px] outline-none"
              >
                <option value="all">All agents</option>
                {agents.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>
          </div>
          <div className="flex min-h-0 flex-1 gap-5">
        {/* ---- stage rail: the 8 stages stacked; Slipped/All/Cancelled
             tucked behind a three-dot menu at the foot ---- */}
        {deals && view === "tiles" ? (
          (() => {
            const STAGE_KEYS = new Set(PORTAL_STAGES.map((s) => s.key));
            const stageTabs = tabs.filter((t) => STAGE_KEYS.has(t.key));
            const extraTabs = tabs.filter((t) => !STAGE_KEYS.has(t.key)); // slipped, all, cancelled
            const activeExtra = extraTabs.find((t) => t.key === activeTab.key) ?? null;

            const TabButton = ({
              t,
              compact = false,
            }: {
              t: (typeof tabs)[number];
              compact?: boolean;
            }) => {
              const activeT = t.key === activeTab.key;
              const v = stageVisual(t.key);
              return (
                <button
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`relative flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                    activeT
                      ? "border-black/30 text-ink"
                      : "border-transparent text-muted hover:border-line hover:text-ink"
                  }`}
                >
                  {/* No chip behind the icon — the doodle carries itself, and
                      at this size a tinted square just boxes it in. Accent red
                      so a stage is recognisable at a glance. */}
                  <span className="relative shrink-0 text-accent">
                    <StageIcon stageKey={t.key} size={26} />
                    <MovementDot kind={t.movement} className="absolute -right-1 -top-1 ring-2 ring-page" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{t.label}</span>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${activeT ? "bg-ink/10 text-ink" : "text-muted"}`}>
                    {t.deals.length}
                  </span>

                </button>
              );
            };

            return (
              <section
                className="enter enter-up flex w-[236px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-line pr-4"
                style={enterAt(80)}
              >
                <h1 className="written mb-3 px-1 text-[24px] leading-none text-ink">
                  Pre-tenancy pipeline
                </h1>
                {stageTabs.map((t) => (
                  <TabButton key={t.key} t={t} />
                ))}

                {/* the active extra (Slipped/All/Cancelled) is promoted so you
                    can always see the current view */}
                {activeExtra ? <TabButton t={activeExtra} compact /> : null}

                {/* three-dot "more views" menu */}
                <div className="relative flex shrink-0 items-center pt-1">
                  <button
                    type="button"
                    onClick={() => setMoreOpen((v) => !v)}
                    aria-label="More views"
                    className={`btn-press flex h-9 w-9 items-center justify-center rounded-lg transition ${
                      moreOpen ? "bg-page text-ink" : "text-muted hover:bg-page hover:text-ink"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                      <circle cx={5} cy={12} r={1.6} />
                      <circle cx={12} cy={12} r={1.6} />
                      <circle cx={19} cy={12} r={1.6} />
                    </svg>
                  </button>
                  {moreOpen ? (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                      <div className="menu-pop absolute left-0 top-full z-50 mt-1 w-52 rounded-xl border border-line bg-card p-1.5 shadow-lg">
                        {[
                          tabs.find((t) => t.key === "all"),
                          tabs.find((t) => t.key === "slipped"),
                          tabs.find((t) => t.key === "archive"),
                        ]
                          .filter((t): t is (typeof tabs)[number] => !!t)
                          .map((t) => (
                            <button
                              key={t.key}
                              type="button"
                              onClick={() => {
                                setTab(t.key);
                                setMoreOpen(false);
                              }}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition hover:bg-page ${
                                t.key === activeTab.key ? "font-semibold text-ink" : "text-ink"
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                {t.label}
                                <MovementDot kind={t.movement} />
                              </span>
                              <span className="text-[11px] text-muted">{t.deals.length}</span>
                            </button>
                          ))}
                        <div className="my-1 border-t border-line" />
                        <button
                          type="button"
                          onClick={() => {
                            if (showCancelled && activeTab.key === "cancelled") setTab("deal_started");
                            setShowCancelled((v) => !v);
                            setMoreOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] text-ink transition hover:bg-page"
                        >
                          {showCancelled ? "Hide cancelled" : "Show cancelled"}
                          <span className="text-[11px] text-muted">{byStage.cancelled.length}</span>
                        </button>
                        {showCancelled ? (
                          <button
                            type="button"
                            onClick={() => {
                              setTab("cancelled");
                              setMoreOpen(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition hover:bg-page ${
                              activeTab.key === "cancelled" ? "font-semibold text-ink" : "text-ink"
                            }`}
                          >
                            View cancelled
                            <span className="text-[11px] text-muted">{byStage.cancelled.length}</span>
                          </button>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              </section>
            );
          })()
        ) : null}

        {/* ---- the deals, with the figures and filters over them ---- */}
        {view === "tiles" ? (
          <section className="enter enter-up min-h-0 min-w-0 flex-1 overflow-y-auto pb-8 pl-1" style={enterAt(120)}>
            {deals == null && !error ? (
              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="h-[130px] animate-pulse rounded-2xl bg-white/70" />
                ))}
              </div>
            ) : activeTab.deals.length === 0 ? (
              <div className="card p-12 text-center text-[13px] text-muted">
                Nothing in {activeTab.label.toLowerCase()} right now.
              </div>
            ) : (
              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {activeTab.deals.map((d) => (
                  <DealTile key={d.app.id} d={d} onOpen={() => setOpenId(d.app.id)} />
                ))}
              </div>
            )}
          </section>
        ) : (
          /* ---- kanban: a column per stage ---- */
          <section className="enter enter-up min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden pb-4" style={enterAt(120)}>
            <div className="flex h-full gap-3">
              {[...PORTAL_STAGES.map((s) => s.key), ...(showCancelled ? ["cancelled"] : [])].map((key) => {
                const col = tabs.find((t) => t.key === key);
                const dealsIn = col?.deals ?? [];
                const v = stageVisual(key);
                return (
                  <div key={key} className="flex w-64 shrink-0 flex-col rounded-2xl bg-black/[0.02]">
                    <div className="flex items-center gap-2 px-3 pb-2 pt-3">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${v.iconBg} ${v.iconText}`}>
                        <StageIcon stageKey={key} size={13} />
                      </span>
                      <span className="text-[12px] font-semibold text-ink">{stageLabel(key)}</span>
                      <span className="ml-auto flex items-center gap-1.5">
                        <MovementDot kind={col?.movement ?? null} />
                        <span className="text-[11px] font-medium text-muted">{dealsIn.length}</span>
                      </span>
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                      {dealsIn.map((d) => (
                        <DealCardMini key={d.app.id} d={d} onOpen={() => setOpenId(d.app.id)} />
                      ))}
                      {dealsIn.length === 0 ? (
                        <p className="px-2 py-6 text-center text-[11px] text-muted">Nothing here</p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
          </div>
        </div>
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

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="text-right">
      <div className="stat-value text-[18px] leading-5">{value}</div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

/* ------------------------------- deal tile ------------------------------- */
// A card per deal: colour-coded stage icon + property address (the icon says
// the stage, so no pill). Tenant & agent, the rent/move-in line, and a footer
// showing pipeline progress (dots filled to the current stage) + notes. A
// movement dot flags anything new or updated at a glance.

function DealTile({ d, onOpen }: { d: BoardDeal; onOpen: () => void }) {
  const attn = dealNeedsAttention(d);
  const upd = dealHasUpdate(d);

  // Stripped back on purpose. The tile sits INSIDE a stage column, so the
  // stage, the progress dots and the stage icon were all repeating what the
  // column already says. What is left is what tells one tile from another:
  // the photo, the address, whose deal it is, and whether it needs a look.
  return (
    <button
      type="button"
      onClick={onOpen}
      className="btn-press group flex w-full flex-col overflow-hidden rounded-2xl border border-line text-left transition hover:border-black/25"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-black/[0.03]">
        {d.app.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={d.app.image}
            alt=""
            aria-hidden
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted">
            <DoodleIcon name="home-1" size={30} />
          </span>
        )}
        {attn || upd ? (
          <span
            title={attn ? "Needs attention" : "Updated recently"}
            className={`absolute right-2.5 top-2.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
              attn ? "bg-accent" : "bg-emerald-500"
            }`}
          />
        ) : null}
      </div>
      <div className="px-3.5 py-3">
        <p className="truncate text-[13px] font-semibold leading-tight">{d.app.propertyName}</p>
        <p className="mt-0.5 truncate text-[11.5px] text-muted">{d.agentName ?? "Unassigned"}</p>
      </div>
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
          m.stageOverride && eff !== portalStageOf(deal.statusKey)
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
  const currentIdx = PORTAL_STAGES.findIndex((s) => s.key === effective);
  const moved = effective !== portalStageOf(deal.statusKey);
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
        <div className="flex items-center gap-4 border-b border-line px-5 py-4 sm:px-8">
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
        {(moved && meta?.stageBy) || actionError || cancelled || deal.archived ? (
          <div className="space-y-2 px-5 pt-4 sm:px-8">
            {cancelled ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[12px] text-red-700">
                This deal was cancelled before completion.
              </p>
            ) : null}
            {deal.archived ? (
              <p className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-[12px] text-muted">
                Archived — the move-in date slipped more than 30 days ago.
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void postMeta({ unarchived: true })}
                  className="font-semibold text-ink underline underline-offset-2"
                >
                  Put it back on the board
                </button>
              </p>
            ) : null}
            {moved && meta?.stageBy ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-800">
                Moved to <span className="font-semibold">{stageLabel(effective)}</span> by{" "}
                {meta.stageBy}
                {meta.stageAt ? ` · ${fmtDateTime(meta.stageAt)}` : ""} — Propoly itself still
                shows {stageLabel(portalStageOf(deal.statusKey))}.
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

        {/* ---- the strip: the four things she looks for first ----
             Only figures that can actually be sourced. The compliance score
             and the documents count from the reference need a business-wide
             REX pull and a Propoly documents GET that does not exist, so they
             are absent rather than shown empty. */}
        <div className="grid grid-cols-2 gap-3 px-5 pt-4 sm:px-8 lg:grid-cols-4">
          {(() => {
            const days =
              deal.app.startDate != null
                ? Math.round(
                    (new Date(deal.app.startDate).getTime() - new Date(today()).getTime()) /
                      86_400_000
                  )
                : null;
            const outstanding = CHECKLIST_ITEMS.length - checklistDone;
            const idx = PORTAL_STAGES.findIndex((x) => x.key === effective);
            const age =
              deal.app.dateReceived != null
                ? Math.round(
                    (new Date(today()).getTime() - new Date(deal.app.dateReceived).getTime()) /
                      86_400_000
                  )
                : null;
            const tiles: Array<{
              icon: string;
              label: string;
              value: string;
              note?: string;
              alert?: boolean;
            }> = [
              {
                icon: "calendar",
                label: "Move-in date",
                value: fmtDate(deal.app.startDate) ?? "No date",
                note:
                  days == null
                    ? "Not set yet"
                    : days < 0
                      ? `${Math.abs(days)} days ago`
                      : days === 0
                        ? "Today"
                        : `In ${days} days`,
                alert: days != null && days < 0 && effective !== "move_day",
              },
              {
                icon: "checklist",
                label: "Outstanding",
                value: String(outstanding),
                note: outstanding === 0 ? "All done" : `of ${CHECKLIST_ITEMS.length} steps`,
                alert: outstanding > 0 && days != null && days <= 7,
              },
              {
                icon: "trend-up",
                label: "Stage",
                value: stageLabel(effective),
                note: idx >= 0 ? `${idx + 1} of ${PORTAL_STAGES.length}` : undefined,
              },
              {
                icon: "clock",
                label: "Deal age",
                value: age == null ? "—" : `${age} days`,
                note: fmtDate(deal.app.dateReceived) ?? undefined,
              },
            ];
            return tiles.map((t) => (
              <div key={t.label} className="rounded-2xl border border-line px-4 py-3">
                <div className="flex items-center gap-2 text-muted">
                  <DoodleIcon name={t.icon} size={15} />
                  <span className="text-[10px] font-semibold uppercase tracking-wide">
                    {t.label}
                  </span>
                </div>
                <p
                  className={`mt-1.5 truncate text-[17px] font-semibold ${
                    t.alert ? "text-accent" : "text-ink"
                  }`}
                >
                  {t.value}
                </p>
                {t.note ? <p className="text-[11px] text-muted">{t.note}</p> : null}
              </div>
            ));
          })()}
        </div>

        {/* ---- three working columns ---- */}
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 sm:p-8 lg:grid-cols-12 lg:overflow-hidden">
          {/* -- the deal -- */}
          <div className="min-h-0 space-y-4 lg:col-span-3 lg:overflow-y-auto lg:pr-1">
            <div className="card card-flat p-5">
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

            {deal.app.image ? (
              <div className="card card-flat overflow-hidden p-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={deal.app.image}
                  alt=""
                  aria-hidden
                  className="h-[136px] w-full object-cover"
                />
                <div className="px-5 py-3.5">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Property
                  </h3>
                  <p className="mt-1 text-[13px] font-medium text-ink">
                    {deal.app.propertyName}
                  </p>
                  <p className="text-[12px] text-muted">{deal.app.locality}</p>
                  {deal.app.listingId ? (
                    <a
                      href={rexListingUrl(deal.app.listingId, "rental")}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-[11px] font-semibold text-muted underline-offset-4 hover:text-ink hover:underline"
                    >
                      Open in REX ↗
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="card card-flat p-5">
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

            <div className="card card-flat p-5">
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
            <div className="card card-flat p-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Progression
              </h3>
              <ol className="mt-4">
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

            <div className="card card-flat p-5">
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
        className="min-w-0 flex-1 rounded-xl border border-line bg-transparent px-3.5 py-2.5 text-[13px] outline-none transition focus:border-gray-400"
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

// Document types we can spot being discussed and suggest attaching. Matched
// against recent message text so the composer can nudge "Attach the EPC".
const DOC_HINTS: { key: string; label: string; re: RegExp }[] = [
  { key: "epc", label: "EPC certificate", re: /\bepc\b|energy performance/i },
  { key: "gas", label: "Gas safety certificate", re: /\bgas\b|cp12|gas safety/i },
  { key: "eicr", label: "EICR", re: /\beicr\b|electric(al)? (report|cert|safety)/i },
  { key: "references", label: "References", re: /referenc/i },
  { key: "agreement", label: "Tenancy agreement", re: /tenancy agreement|\bast\b|contract/i },
  { key: "inventory", label: "Inventory", re: /inventory|check[- ]?in/i },
  { key: "id", label: "ID / Right to Rent", re: /right to rent|\bid\b|passport|visa/i },
];

interface PendingAttachment {
  filename: string;
  content: string; // base64
  size: number;
}

function EmailsTab({ deal, onOpenMailbox }: { deal: BoardDeal; onOpenMailbox: () => void }) {
  const [state, setState] = useState<{
    loading: boolean;
    connected: boolean;
    noAgentEmail?: boolean;
    error?: string;
    emails: DealEmail[];
    agentName?: string | null;
    agentEmail?: string | null;
  }>({ loading: true, connected: true, emails: [] });

  // Composer
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const agentName = state.agentName || deal.agentName || "the agent";
  const agentFirst = agentName.split(" ")[0];

  const load = useCallback(() => {
    fetch(`/api/deals/${deal.app.id}/emails`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: typeof state) =>
        setState({
          loading: false,
          connected: d.connected !== false,
          noAgentEmail: d.noAgentEmail,
          error: d.error,
          emails: d.emails ?? [],
          agentName: d.agentName,
          agentEmail: d.agentEmail,
        })
      )
      .catch(() =>
        setState((s) => ({ ...s, loading: false, error: "Couldn't load emails just now." }))
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal.app.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the log pinned to the newest message.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.emails, composing]);

  // Suggested docs — from keywords in the most recent inbound messages.
  const suggestions = useMemo(() => {
    const text = state.emails
      .filter((e) => e.direction === "in")
      .slice(0, 5)
      .map((e) => `${e.subject} ${e.body}`)
      .join(" ");
    return DOC_HINTS.filter((h) => h.re.test(text));
  }, [state.emails]);

  async function onFiles(files: FileList | null) {
    if (!files) return;
    const next: PendingAttachment[] = [];
    for (const f of Array.from(files)) {
      const buf = await f.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      next.push({ filename: f.name, content: btoa(bin), size: f.size });
    }
    setAttachments((prev) => [...prev, ...next]);
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/deals/${deal.app.id}/email-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          attachments: attachments.map((a) => ({ filename: a.filename, content: a.content })),
        }),
      });
      const d = (await res.json()) as { ok?: boolean; email?: DealEmail; error?: string };
      if (!res.ok || !d.email) throw new Error(d.error ?? "Couldn't send.");
      setState((s) => ({ ...s, emails: [...s.emails, d.email!] }));
      setDraft("");
      setAttachments([]);
      setComposing(false);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Couldn't send.");
    } finally {
      setSending(false);
    }
  }

  if (state.loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`h-10 animate-pulse rounded-2xl bg-page ${i % 2 ? "ml-10" : "mr-10"}`} />
        ))}
        <p className="pt-1 text-center text-[11px] text-muted">Loading your emails with {agentFirst}…</p>
      </div>
    );
  }

  if (!state.connected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="max-w-xs text-[13px] text-muted">
          Connect your email to message {agentFirst} here — it sends from your mailbox and
          keeps a chat log against the deal.
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

  if (state.noAgentEmail) {
    return (
      <p className="rounded-xl bg-page px-4 py-3 text-[12px] text-muted">
        No email address on file for {agentName}, so there&apos;s no one to message yet.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* who we're emailing */}
      <div className="flex items-center gap-2 border-b border-line pb-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold accent-text">
          {agentName.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("")}
        </span>
        <div className="leading-tight">
          <p className="text-[13px] font-semibold">Emailing {agentName}</p>
          <p className="text-[11px] text-muted">{state.agentEmail}</p>
        </div>
      </div>

      {/* chat log */}
      <div ref={logRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto py-3">
        {state.error ? (
          <p className="rounded-xl bg-page px-4 py-3 text-[12px] text-muted">{state.error}</p>
        ) : state.emails.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-muted">
            No emails with {agentFirst} yet. Start the conversation below.
          </p>
        ) : (
          state.emails.map((e) => <EmailBubble key={e.id} e={e} />)
        )}
      </div>

      {/* composer */}
      {composing ? (
        <div className="modal-pop rounded-2xl border border-line bg-card p-3 shadow-lg">
          {suggestions.length > 0 ? (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Suggested</span>
              {suggestions.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  title={`Attach the ${s.label} — pick it from your files`}
                  className="rounded-full border border-line bg-page px-2 py-0.5 text-[11px] font-medium text-muted transition hover:text-ink"
                >
                  + {s.label}
                </button>
              ))}
            </div>
          ) : null}

          {attachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((a, i) => (
                <span key={i} className="flex items-center gap-1 rounded-lg border border-line bg-page px-2 py-1 text-[11px]">
                  <svg viewBox="0 0 24 24" className="h-3 w-3 text-muted" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.2 9.19a1 1 0 0 1-1.41-1.41l8.49-8.49" />
                  </svg>
                  <span className="max-w-[120px] truncate">{a.filename}</span>
                  <button type="button" onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} className="text-muted hover:text-ink">
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
              if (e.key === "Escape" && !draft) setComposing(false);
            }}
            rows={3}
            placeholder={`Write to ${agentFirst}…`}
            className="w-full resize-none rounded-xl border border-line bg-transparent px-3 py-2 text-[13px] outline-none transition focus:border-gray-400"
          />
          {sendError ? <p className="mt-1 text-[12px] text-accent">{sendError}</p> : null}
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                title="Attach a file"
                className="btn-press flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted transition hover:text-ink"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => { setComposing(false); setSendError(null); }}
                className="px-2 text-[12px] font-medium text-muted transition hover:text-ink"
              >
                Cancel
              </button>
            </div>
            <button
              type="button"
              disabled={sending || !draft.trim()}
              onClick={() => void send()}
              className="btn-press rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition disabled:opacity-50"
              style={{ background: BRAND.accent }}
            >
              {sending ? "Sending…" : `Send to ${agentFirst}`}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="btn-press flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold text-white shadow-md transition hover:shadow-lg"
            style={{ background: BRAND.accent }}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            Email {agentFirst}
          </button>
        </div>
      )}
    </div>
  );
}

// Compact card for the kanban columns — the column header already says the
// stage, so this is address + tenant/agent + move-in, with a movement dot.
function DealCardMini({ d, onOpen }: { d: BoardDeal; onOpen: () => void }) {
  const lead = d.app.tenants.find((t) => t.isPrimary) ?? d.app.tenants[0];
  const overdue = isOverdue(d);
  const attn = dealNeedsAttention(d);
  const upd = dealHasUpdate(d);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="btn-press w-full rounded-xl border border-line p-2.5 text-left transition hover:border-black/20"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold leading-snug">{d.app.propertyName}</p>
        <MovementDot kind={attn ? "red" : upd ? "green" : null} className="mt-1 shrink-0" />
      </div>
      <p className="mt-0.5 truncate text-[11px] text-muted">
        {lead ? lead.name : "No tenant recorded"}
        {d.app.tenants.length > 1 ? ` +${d.app.tenants.length - 1}` : ""}
      </p>
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate text-muted">{d.agentName ?? "—"}</span>
        <span className="shrink-0 text-ink">
          {d.app.startDate ? `${fmtDate(d.app.startDate)}${overdue ? " · slipped" : ""}` : "TBC"}
        </span>
      </div>
      {d.portal.notesCount > 0 ? (
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted">
          <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {d.portal.notesCount}
          {d.portal.lastNote?.authorRole === "agent" ? (
            <span className="ml-0.5 rounded bg-red-50 px-1 text-[9px] font-semibold text-red-600">reply</span>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

function EmailBubble({ e }: { e: DealEmail }) {
  const [open, setOpen] = useState(false);
  const out = e.direction === "out";
  const preview = e.body.length > 220 && !open ? e.body.slice(0, 220) + "…" : e.body;
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-left transition ${
          out
            ? "rounded-br-md bg-accent text-white"
            : "rounded-bl-md border border-line bg-white text-ink"
        }`}
      >
        <div className={`mb-0.5 flex items-baseline gap-2 text-[10px] ${out ? "text-white/70" : "text-muted"}`}>
          <span className="font-semibold">{out ? "You" : e.from.replace(/<.*>/, "").trim() || e.from}</span>
          <span>{e.date ? fmtDateTime(e.date) : ""}</span>
        </div>
        {e.subject ? <p className={`text-[12px] font-semibold ${out ? "text-white" : "text-ink"}`}>{e.subject}</p> : null}
        <p className={`whitespace-pre-wrap text-[12.5px] leading-relaxed ${out ? "text-white/95" : "text-ink"}`}>
          {preview || "(no text)"}
        </p>
      </button>
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

/* ------------------------------ date picker ------------------------------ */
// A softer, animated calendar for follow-up dates — bubbles up from the
// trigger with rounded corners and quick-pick shortcuts, instead of the
// browser's stock date input.

const DP_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DP_DOW = ["M", "T", "W", "T", "F", "S", "S"];

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CAL_W = 264;
const CAL_H = 340;

function DatePicker({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T00:00:00`) : null;
  const [view, setView] = useState(() => (selected ? new Date(selected) : new Date()));
  const btnRef = useRef<HTMLButtonElement>(null);
  // Fixed position, computed from the trigger and clamped to the viewport so
  // the calendar is never clipped by the scrolling panel it lives in.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const todayIso = today();

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const place = () => {
      const r = btnRef.current!.getBoundingClientRect();
      const left = Math.min(Math.max(8, r.left), window.innerWidth - CAL_W - 8);
      // Prefer above the trigger; drop below if there isn't room.
      const above = r.top - CAL_H - 8;
      const top = above >= 8 ? above : Math.min(r.bottom + 8, window.innerHeight - CAL_H - 8);
      setPos({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const year = view.getFullYear();
  const month = view.getMonth();
  // Monday-first grid.
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const label = value
    ? new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "Set a date";

  const pick = (d: Date) => {
    onChange(toIso(d));
    setOpen(false);
  };
  const quick = (addDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + addDays);
    pick(d);
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`btn-press flex items-center gap-2 rounded-xl border bg-transparent px-3 py-2.5 text-[13px] outline-none transition ${
          value ? "border-line text-ink" : "border-line text-muted"
        } hover:border-gray-400`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x={3} y={4.5} width={18} height={16} rx={2.5} />
          <path d="M3 9h18M8 3v3M16 3v3" />
        </svg>
        {label}
      </button>

      {open && typeof document !== "undefined" ? (
        createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
            <div
              className="cal-pop fixed z-[61] w-[264px] rounded-2xl border border-line bg-card p-3 shadow-xl"
              style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
            >
            {/* month header */}
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setView(new Date(year, month - 1, 1))}
                className="btn-press flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:bg-page hover:text-ink"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <span className="text-[13px] font-semibold">{DP_MONTHS[month]} {year}</span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setView(new Date(year, month + 1, 1))}
                className="btn-press flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:bg-page hover:text-ink"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
              </button>
            </div>

            {/* day-of-week */}
            <div className="grid grid-cols-7 gap-1">
              {DP_DOW.map((d, i) => (
                <span key={i} className="py-1 text-center text-[10px] font-semibold uppercase text-muted">{d}</span>
              ))}
            </div>

            {/* days */}
            <div className="grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                if (!d) return <span key={i} />;
                const iso = toIso(d);
                const isSel = iso === value;
                const isToday = iso === todayIso;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pick(d)}
                    style={{ ["--cal-delay" as string]: `${i * 6}ms` }}
                    className={`cal-day flex h-8 items-center justify-center rounded-full text-[12.5px] transition ${
                      isSel
                        ? "font-semibold text-white"
                        : isToday
                          ? "font-semibold accent-text"
                          : "text-ink hover:bg-page"
                    }`}
                  >
                    <span className={isSel ? "flex h-8 w-8 items-center justify-center rounded-full" : ""} style={isSel ? { background: BRAND.accent } : undefined}>
                      {d.getDate()}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* quick picks */}
            <div className="mt-2 flex gap-1.5 border-t border-line pt-2">
              {[
                { label: "Today", days: 0 },
                { label: "Tomorrow", days: 1 },
                { label: "+1 week", days: 7 },
              ].map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => quick(q.days)}
                  className="btn-press flex-1 rounded-lg bg-page px-2 py-1.5 text-[11px] font-medium text-muted transition hover:text-ink"
                >
                  {q.label}
                </button>
              ))}
            </div>
            </div>
          </>,
          document.body
        )
      ) : null}
    </div>
  );
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
          className="min-w-0 flex-1 rounded-xl border border-line bg-transparent px-3.5 py-2.5 text-[13px] outline-none transition focus:border-gray-400"
        />
        <DatePicker value={due} onChange={setDue} />
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
