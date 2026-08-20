"use client";

// /admin — Susan's business dashboard. Auth flow: refreshUser() → inline
// login if signed out → locked card if signed in but not in ADMIN_EMAILS →
// full tabbed dashboard (mirrors the Base44 tabs, but functional) if admin.
// Presentation mode: PresentProvider + ←/→ tab keys + optional 15s auto-cycle.

import { useCallback, useEffect, useMemo, useState } from "react";
import BrandMark from "@/components/BrandMark";
import PasswordInput from "@/components/PasswordInput";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import { PresentProvider, PresentButton, usePresent } from "@/components/PresentMode";
import { getUser, logIn, refreshUser, signOut } from "@/lib/session";
import { BRAND } from "@/lib/brand";
import type { UserProfile } from "@/lib/types";
import type { SeedData } from "@/lib/seed-data"; // type-only — erased at build
import { currentMonth, monthLabel, monthProgressLabel, previousMonth, recentMonths } from "@/lib/format";

import Overview from "@/app/admin/tabs/overview";
import PaidLeads from "@/app/admin/tabs/paid-leads";
import MoveIns from "@/app/admin/tabs/move-ins";
import Income from "@/app/admin/tabs/income";
import Pnl from "@/app/admin/tabs/pnl";
import Forecast from "@/app/admin/tabs/forecast";
import Agents from "@/app/admin/tabs/agents";
import Portfolio from "@/app/admin/tabs/portfolio";
import Arrears from "@/app/admin/tabs/arrears";
import Compliance from "@/app/admin/tabs/compliance";
import AssistantTab from "@/app/admin/tabs/assistant";
import Diagnostics from "@/app/admin/tabs/diagnostics";

/* ------------------------------- tabs ------------------------------- */

// Tabs receive the month and the admin-gated snapshot seed (fetched once from
// /api/admin/seed — lib/seed-data.ts is server-only, so seed data reaches the
// client only through that authenticated route, never via the JS bundle).
type TabComponent = (props: { month: string; seed: SeedData }) => React.ReactNode;

const TABS: { key: string; label: string; Component: TabComponent }[] = [
  { key: "overview", label: "Overview", Component: Overview },
  { key: "paid-leads", label: "Paid Leads", Component: PaidLeads },
  { key: "move-ins", label: "Move-ins & Pipeline", Component: MoveIns },
  { key: "income", label: "Income", Component: Income },
  { key: "pnl", label: "P&L", Component: Pnl },
  { key: "forecast", label: "Forecast", Component: Forecast },
  { key: "agents", label: "Agents", Component: Agents },
  { key: "portfolio", label: "Portfolio", Component: Portfolio },
  { key: "arrears", label: "Arrears", Component: Arrears },
  { key: "compliance", label: "Compliance", Component: Compliance },
  { key: "assistant", label: "Assistant", Component: AssistantTab },
  { key: "diagnostics", label: "Diagnostics", Component: Diagnostics },
];

// Presentation running order — the boardroom story, not the working tabs.
// Diagnostics/Compliance/Arrears etc. are for doing the job, not showing it.
const PRESENT_KEYS = ["overview", "paid-leads", "income", "portfolio", "forecast"];

// The month list is DERIVED, never typed out. It was hardcoded Jan–Jul 2026,
// so on 1 August the dashboard had no August to offer and sat on July —
// nothing was stale, there was simply no way to ask for the new month.
//
// Twelve rolling months so January can still look back at December. Signing in
// always lands on the live month: month-to-date, however far in we are.

/* --------------------------- CRM shell chrome --------------------------- */

const SIDEBAR_W = 240;
const SWOOP = 22;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

// One seamless white L-shape (sidebar + top bar) with a concave corner swoop —
// mirrors the customer dashboard shell so the two feel like one product.
function ChromeSurface({ vw, vh }: { vw: number; vh: number }) {
  const sw = SIDEBAR_W;
  const th = 64;
  const r = SWOOP;
  const d =
    `M0 0 L${vw} 0 L${vw} ${th} L${sw + r} ${th} ` +
    `A${r} ${r} 0 0 0 ${sw} ${th + r} L${sw} ${vh} L0 ${vh} Z`;
  return (
    <div
      aria-hidden
      className="hide-when-presenting pointer-events-none fixed inset-0 z-20 hidden bg-white lg:block"
      style={{
        clipPath: `path('${d}')`,
        WebkitClipPath: `path('${d}')`,
        filter:
          "drop-shadow(3px 0 12px rgba(0,0,0,0.05)) drop-shadow(0 4px 12px rgba(0,0,0,0.05))",
      }}
    />
  );
}

/* ----------------------------- auth page ----------------------------- */

export default function AdminPage() {
  // undefined = still checking the session; null = signed out.
  const [user, setUser] = useState<UserProfile | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    // Render cache first for a fast paint, then re-validate with the server.
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

  if (user === null) {
    return <AdminLogin onLoggedIn={setUser} />;
  }

  if (!user.isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="card w-full max-w-md p-8 text-center">
          <BrandMark size={44} className="mx-auto" />
          <h1 className="mt-4 text-lg font-semibold">
            This area is restricted to the business owner.
          </h1>
          <p className="mt-2 text-sm text-muted">
            You&apos;re signed in as {user.email}, which doesn&apos;t have
            admin access. Your own stats live on your dashboard.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <a
              href={user.isPreTenancy ? "/pretenancy" : "/dashboard"}
              className="btn-press rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
            >
              {user.isPreTenancy ? "Go to pre-tenancy" : "Go to my dashboard"}
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

  return (
    <PresentProvider>
      <AdminShell user={user} onSignOut={handleSignOut} />
    </PresentProvider>
  );
}

/* ----------------------------- inline login ----------------------------- */

function AdminLogin({
  onLoggedIn,
}: {
  onLoggedIn: (user: UserProfile) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await logIn(email.trim(), password);
      onLoggedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect email or password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="card w-full max-w-md p-8">
        <div className="flex items-center gap-3">
          <BrandMark size={40} />
          <div>
            <h1 className="text-lg font-semibold">TLE Business Dashboard</h1>
            <p className="text-xs text-muted">Owner sign in</p>
          </div>
        </div>
        <form onSubmit={submit} className="mt-6 grid gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
              Email
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-accent"
              placeholder="you@thelettingexperts.co.uk"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
              Password
            </span>
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="Your password"
            />
          </label>
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy || !email || !password}
            className="btn-press mt-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-muted">
          Admin access is limited to the business owner. Agents sign in at{" "}
          <a href="/login" className="accent-text underline">
            the partner portal
          </a>
          .
        </p>
      </div>
    </main>
  );
}

/* ---------------------------- dashboard shell ---------------------------- */

function AdminShell({
  user,
  onSignOut,
}: {
  user: UserProfile;
  onSignOut: () => Promise<void>;
}) {
  const { presenting } = usePresent();
  const [tabIndex, setTabIndex] = useState(0);
  // Opens on the last COMPLETE month, not the one we're standing in.
  //
  // Susan's centre reports finished work, and the current month is never
  // finished — move-ins on the 3rd read as a collapse against a full July when
  // they are simply three days old. The picker still offers the live month for
  // anyone who wants to watch it accumulate; it just isn't the default answer.
  //
  // Resolved once per mount rather than at module load, so a tab left open
  // overnight on the 31st picks up the new month on its next visit.
  const [month, setMonth] = useState(previousMonth);
  const [autoCycle, setAutoCycle] = useState(false);
  const [seed, setSeed] = useState<SeedData | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  // Load the snapshot seed once via the admin-gated API.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/seed", { cache: "no-store" });
        if (!res.ok) throw new Error(`Seed fetch failed (${res.status})`);
        const data = (await res.json()) as { seed: SeedData };
        if (!cancelled) setSeed(data.seed);
      } catch {
        if (!cancelled) {
          setSeedError(
            "Couldn't load the business snapshot data — refresh to try again."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The curated running order, as indexes into TABS.
  const presentOrder = useMemo(
    () =>
      PRESENT_KEYS.map((k) => TABS.findIndex((t) => t.key === k)).filter((i) => i >= 0),
    []
  );

  // Step through the curated order (wrapping) rather than every working tab.
  const stepPresent = useCallback(
    (dir: 1 | -1) => {
      setTabIndex((i) => {
        const pos = presentOrder.indexOf(i);
        // Not on a presentation slide → start at the first one.
        if (pos === -1) return presentOrder[0] ?? i;
        return presentOrder[(pos + dir + presentOrder.length) % presentOrder.length];
      });
    },
    [presentOrder]
  );

  // Entering present mode from a working tab (e.g. Diagnostics) → jump to the
  // start of the story rather than presenting a tab that isn't in it.
  useEffect(() => {
    if (!presenting) return;
    setTabIndex((i) => (presentOrder.includes(i) ? i : (presentOrder[0] ?? i)));
  }, [presenting, presentOrder]);

  // ←/→ move through the running order while presenting.
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") stepPresent(1);
      else if (e.key === "ArrowLeft") stepPresent(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting, stepPresent]);

  // Optional auto-cycle through the running order every 15s while presenting.
  useEffect(() => {
    if (!presenting || !autoCycle) return;
    const id = window.setInterval(() => stepPresent(1), 15000);
    return () => window.clearInterval(id);
  }, [presenting, autoCycle, stepPresent]);

  const active = TABS[tabIndex];
  const ActiveComponent = active.Component;

  // Newest first: the live month is the one she wants, so it shouldn't be at
  // the bottom of a twelve-item list. It's labelled, so there's no doubt which
  // figures are still moving and which are finished.
  const monthOptions = useMemo(() => {
    const live = currentMonth();
    return recentMonths(12)
      .slice()
      .reverse()
      .map((m) => ({
        value: m,
        label: m === live ? `${monthLabel(m)} — live` : monthLabel(m),
      }));
  }, []);

  const monthStatus = monthProgressLabel(month);

  return (
    <div
      className="type-admin relative min-h-screen"
      style={{ background: presenting ? undefined : "var(--page)" }}
    >
      {/* ambient glow */}
      <div className="hide-when-presenting pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className="absolute"
          style={{
            bottom: "-30%",
            right: "-25%",
            width: "120%",
            height: "120%",
            background: `radial-gradient(circle at 50% 52%, ${BRAND.accent}14, transparent 66%)`,
          }}
        />
      </div>

      {vp.w > 0 ? <ChromeSurface vw={vp.w} vh={vp.h} /> : null}

      {/* ── Desktop sidebar ── */}
      <aside className="hide-when-presenting fixed inset-y-0 left-0 z-30 hidden w-60 flex-col lg:flex">
        <div className="px-5 pt-7">
          <WorkspaceSwitcher user={user} current="admin" size={34} />
        </div>

        <div className="mx-5 mt-6 border-t border-line" />

        <nav className="mt-5 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Dashboard sections">
          {TABS.map((tab, i) => {
            const on = i === tabIndex;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setTabIndex(i)}
                aria-current={on ? "page" : undefined}
                className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                  on ? "accent-soft-bg text-ink" : "text-muted hover:bg-black/[0.03] hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full accent-soft-bg text-[12px] font-semibold accent-text">
              {initials(user.name) || "?"}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Desktop top bar ── */}
      <header
        className="hide-when-presenting fixed right-0 top-0 z-40 hidden h-16 items-center justify-between gap-3 pl-6 pr-8 lg:flex"
        style={{ left: SIDEBAR_W }}
      >
        <div className="min-w-0">
          <h1 className="truncate text-[16px] font-semibold leading-tight">{active.label}</h1>
          {/* "day 7 of 31" is the difference between a bad month and an early
              one — without it a small figure on the 7th reads as alarming. */}
          <p className="truncate text-[12px] text-muted">
            TLE Business · {monthLabel(month)} ·{" "}
            <span className={monthStatus.startsWith("Live") ? "text-accent" : undefined}>
              {monthStatus}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
            aria-label="Month"
          >
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <a
            href="/dashboard"
            className="btn-press flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium text-muted transition hover:text-ink"
            title="Switch to the customer dashboard"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Customer view
          </a>
          <PresentButton />
          <button
            type="button"
            onClick={() => void onSignOut()}
            className="btn-press rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium text-muted transition hover:text-ink"
            title={`Signed in as ${user.email}`}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ── Mobile top bar ── */}
      <header className="hide-when-presenting sticky top-0 z-40 border-b border-line bg-white lg:hidden">
        <div className="flex h-14 items-center gap-3 px-4">
          <WorkspaceSwitcher user={user} current="admin" size={28} />
          <div className="ml-auto flex items-center gap-2">
            <a href="/dashboard" className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted">Customer</a>
            <PresentButton />
            <button onClick={() => void onSignOut()} className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted">Sign out</button>
          </div>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto px-3 pb-2" aria-label="Dashboard sections">
          {TABS.map((tab, i) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setTabIndex(i)}
              aria-current={i === tabIndex ? "page" : undefined}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                i === tabIndex ? "bg-accent text-white" : "text-muted hover:bg-accent-soft hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* ── Presenting: floating controls + position dots ── */}
      {presenting ? (
        <>
          <div className="fixed right-4 top-4 z-50 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoCycle((v) => !v)}
              aria-pressed={autoCycle}
              className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium ${
                autoCycle ? "border-accent bg-accent text-white" : "border-line bg-card"
              }`}
              style={autoCycle ? undefined : { color: "#101014" }}
            >
              {autoCycle ? "Auto-cycle on" : "Auto-cycle"}
            </button>
            <PresentButton />
          </div>
          <div className="fixed inset-x-6 top-3 z-40 flex items-center gap-2">
            {presentOrder.map((t) => (
              <span
                key={TABS[t].key}
                title={TABS[t].label}
                className="h-1.5 flex-1 rounded-full transition-colors"
                style={{ background: t === tabIndex ? "#E31F36" : "#26262E" }}
              />
            ))}
          </div>
          <p className="fixed bottom-3 left-1/2 -translate-x-1/2 text-[11px]" style={{ color: "#6B6B76" }}>
            ← → to change tabs · Esc to exit
          </p>
        </>
      ) : null}

      {/* ── Main ── */}
      <main
        className={
          presenting
            ? "px-6 py-10"
            : "dash-cards px-4 pb-16 pt-4 lg:ml-[240px] lg:px-8 lg:pt-[80px]"
        }
      >
        <div className="mx-auto max-w-[1400px]">
          {presenting ? (
            <h2 className="mb-5 text-2xl font-semibold">{active.label}</h2>
          ) : null}
          <section key={active.key}>
            {seed ? (
              <ActiveComponent month={month} seed={seed} />
            ) : seedError ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
                {seedError}
              </p>
            ) : (
              <p className="text-sm text-muted">Loading business data…</p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
