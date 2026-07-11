"use client";

// /admin — Susan's business dashboard. Auth flow: refreshUser() → inline
// login if signed out → locked card if signed in but not in ADMIN_EMAILS →
// full tabbed dashboard (mirrors the Base44 tabs, but functional) if admin.
// Presentation mode: PresentProvider + ←/→ tab keys + optional 15s auto-cycle.

import { useCallback, useEffect, useMemo, useState } from "react";
import BrandMark from "@/components/BrandMark";
import PasswordInput from "@/components/PasswordInput";
import { PresentProvider, PresentButton, usePresent } from "@/components/PresentMode";
import { getUser, logIn, refreshUser, signOut } from "@/lib/session";
import type { UserProfile } from "@/lib/types";
import { monthLabel } from "@/lib/format";

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
import Diagnostics from "@/app/admin/tabs/diagnostics";

/* ------------------------------- tabs ------------------------------- */

type TabComponent = (props: { month: string }) => React.ReactNode;

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
  { key: "diagnostics", label: "Diagnostics", Component: Diagnostics },
];

// Month selector range: Jan–Jul 2026, defaulting to July (the live month).
const MONTHS = [
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
];
const DEFAULT_MONTH = "2026-07";

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
  const [month, setMonth] = useState(DEFAULT_MONTH);
  const [autoCycle, setAutoCycle] = useState(false);

  // ←/→ move tabs while presenting.
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        setTabIndex((i) => (i + 1) % TABS.length);
      } else if (e.key === "ArrowLeft") {
        setTabIndex((i) => (i - 1 + TABS.length) % TABS.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting]);

  // Optional auto-cycle through tabs every 15s while presenting.
  useEffect(() => {
    if (!presenting || !autoCycle) return;
    const id = window.setInterval(() => {
      setTabIndex((i) => (i + 1) % TABS.length);
    }, 15000);
    return () => window.clearInterval(id);
  }, [presenting, autoCycle]);

  const active = TABS[tabIndex];
  const ActiveComponent = active.Component;

  const monthOptions = useMemo(
    () => MONTHS.map((m) => ({ value: m, label: monthLabel(m) })),
    []
  );

  return (
    <main className="mx-auto min-h-screen max-w-[1400px] px-4 py-5 sm:px-6">
      {/* ------------------------------ header ------------------------------ */}
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <BrandMark size={38} white={presenting} />
          <div>
            <h1 className="text-lg font-semibold leading-tight">
              TLE Business Dashboard
            </h1>
            <p className="text-xs text-muted">
              {monthLabel(month)}
              {presenting ? ` · ${active.label}` : ""}
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="hide-when-presenting rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
            aria-label="Month"
          >
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          {presenting ? (
            <button
              type="button"
              onClick={() => setAutoCycle((v) => !v)}
              aria-pressed={autoCycle}
              className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium ${
                autoCycle
                  ? "border-accent bg-accent text-white"
                  : "border-line bg-card"
              }`}
              style={autoCycle ? undefined : { color: "#101014" }}
            >
              {autoCycle ? "Auto-cycle on" : "Auto-cycle"}
            </button>
          ) : null}
          <PresentButton />
          <button
            type="button"
            onClick={() => void onSignOut()}
            className="hide-when-presenting btn-press rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium"
            title={`Signed in as ${user.email}`}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ------------------------------ tab bar ------------------------------ */}
      <nav
        className="hide-when-presenting mt-4 flex gap-1 overflow-x-auto rounded-xl border border-line bg-card p-1"
        aria-label="Dashboard sections"
      >
        {TABS.map((tab, i) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setTabIndex(i)}
            aria-current={i === tabIndex ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
              i === tabIndex
                ? "bg-accent text-white"
                : "text-muted hover:bg-accent-soft hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Presenting: slim position indicator instead of the tab bar */}
      {presenting ? (
        <div className="mt-4 flex items-center gap-2">
          {TABS.map((tab, i) => (
            <span
              key={tab.key}
              title={tab.label}
              className="h-1.5 flex-1 rounded-full"
              style={{ background: i === tabIndex ? "#E31F36" : "#26262E" }}
            />
          ))}
        </div>
      ) : null}

      {/* ------------------------------ content ------------------------------ */}
      <section className="mt-5 pb-16" key={active.key}>
        <ActiveComponent month={month} />
      </section>

      {presenting ? (
        <p className="fixed bottom-3 left-1/2 -translate-x-1/2 text-[11px]" style={{ color: "#6B6B76" }}>
          ← → to change tabs · Esc to exit
        </p>
      ) : null}
    </main>
  );
}
