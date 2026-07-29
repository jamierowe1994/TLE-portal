"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import AssistantBubble from "@/components/AssistantBubble";
import SearchOverlay from "@/components/SearchOverlay";
import DoodleIcon from "@/components/DoodleIcon";
import { refreshUser, signOut } from "@/lib/session";
import type { UserProfile } from "@/lib/types";

// Agent dashboard shell — a flat, Notion-style layout: one grey canvas, a grey
// nav rail that blends into it (broken up by slightly darker hairlines), and
// white cards reserved for the content that matters. The account selector sits
// at the top of the rail; TLE OS is a single item pinned at the bottom.

// Icons are hand-drawn doodles from /public/icons/doodle (see DoodleIcon).
const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/dashboard/todos", label: "To-dos", icon: "checklist" },
  { href: "/dashboard/listings", label: "My Properties", icon: "home" },
  { href: "/dashboard/applications", label: "Applications", icon: "file-contract" },
  { href: "/dashboard/compliance", label: "Compliance", icon: "shield" },
  { href: "/dashboard/portfolio", label: "My Portfolio", icon: "suitcase" },
  { href: "/dashboard/ads", label: "My Ads", icon: "megaphone" },
  { href: "/dashboard/forecast", label: "Forecast", icon: "trend-up" },
];

// Hairlines a shade darker than the grey canvas — the only thing that breaks
// the rail up, exactly like the reference.
const RAIL_LINE = "border-black/[0.08]";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

// A time-of-day welcome with a little personality.
function greeting(name: string): { hello: string; prompt: string } {
  const first = name.split(" ")[0] || name;
  const h = new Date().getHours();
  if (h < 5) return { hello: `Still up, ${first}?`, prompt: "Burning the midnight oil — don't work too hard." };
  if (h < 7) return { hello: `Morning, ${first}`, prompt: "You're an early riser — let's make it count." };
  if (h < 12) return { hello: `Good morning, ${first}`, prompt: "Here's where you're at today." };
  if (h < 17) return { hello: `Good afternoon, ${first}`, prompt: "Hope the day's going your way." };
  if (h < 21) return { hello: `Good evening, ${first}`, prompt: "Winding down — here's your day." };
  return { hello: `Evening, ${first}`, prompt: "Late one? Here's the latest." };
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [checking, setChecking] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // ⌘K / Ctrl+K opens the property search from anywhere in the shell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the account menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    let cancelled = false;
    refreshUser().then((u) => {
      if (cancelled) return;
      if (!u) {
        router.replace("/login");
        return;
      }
      setUser(u);
      setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  useEffect(() => setMenuOpen(false), [pathname]);

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  if (checking || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex items-center gap-3 text-sm text-muted">
          <BrandMark size={28} />
          <span>Checking your session…</span>
        </div>
      </div>
    );
  }

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
  const { hello, prompt } = greeting(user.name);

  // Reference-style items with hand-drawn doodle icons — no tiles, no pills.
  // The active one simply goes deeper black and a touch bolder; everything
  // else sits back in grey until you're looking for it.
  const navItem =
    "flex items-center gap-3 rounded-md px-2.5 py-2 text-[14px] transition-colors";

  const NavIcon = ({ active, name }: { active: boolean; name: string }) => (
    <DoodleIcon
      name={name}
      size={19}
      className={`transition-colors ${active ? "text-ink" : "text-muted/80"}`}
    />
  );

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <>
      {NAV.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`${navItem} ${
              active
                ? "font-semibold text-ink"
                : "text-muted hover:bg-black/[0.04] hover:text-ink"
            }`}
          >
            <NavIcon active={active} name={item.icon} />
            {item.label}
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="relative min-h-screen" style={{ background: "var(--page)" }}>
      {/* ── Desktop sidebar — grey on grey, broken up by darker hairlines and
          capped off by its own right-hand line ── */}
      <aside className={`fixed inset-y-0 left-0 z-30 hidden w-[240px] flex-col border-r ${RAIL_LINE} lg:flex`}>
        {/* Account selector, top of the rail — photo, name, dropdown. Just an
            outline in the same hairline grey; no fill. */}
        <div className="relative mt-5 px-3" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={`flex w-full items-center gap-2.5 rounded-lg border ${RAIL_LINE} px-3 py-2.5 text-left transition hover:bg-white/60 ${
              menuOpen ? "bg-white/60" : ""
            }`}
          >
            {user.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.photo} alt={user.name} className="h-6 w-6 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/[0.08] text-[10px] font-semibold text-ink">
                {initials(user.name) || "?"}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{user.name}</span>
            <svg
              className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-150 ${menuOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {menuOpen ? (
            <div className="menu-pop absolute left-3 right-3 top-[calc(100%+0.25rem)] z-50 overflow-hidden rounded-xl border border-line bg-card p-1 shadow-xl">
              <Link
                href="/dashboard/profile"
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-ink transition hover:bg-black/[0.04]"
              >
                <svg className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <circle cx={12} cy={12} r={3} />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.24.58.78.98 1.42 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
                Settings
              </Link>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-muted transition hover:bg-black/[0.04] hover:text-ink"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                Sign out
              </button>
            </div>
          ) : null}
        </div>

        {/* Notifications + search, reference-style, above the first divider */}
        <div className="mt-3 space-y-0.5 px-3">
          <span
            className={`${navItem} cursor-default text-muted/60`}
            title="Notifications — coming soon"
          >
            <NavIcon active={false} name="bell" />
            Notifications
          </span>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className={`${navItem} w-full text-muted hover:bg-black/[0.04] hover:text-ink`}
          >
            <NavIcon active={false} name="search" />
            Search
            <kbd className="ml-auto rounded border border-black/[0.08] px-1 py-px text-[9px] text-muted/70">⌘K</kbd>
          </button>
        </div>

        <div className={`mx-4 mt-3 border-t ${RAIL_LINE}`} />

        <nav className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-3">
          <NavLinks />
          {user.isAdmin ? (
            <Link
              href="/admin"
              className={`${navItem} mt-2 text-muted hover:bg-black/[0.04] hover:text-ink`}
            >
              <NavIcon active={false} name="setting" />
              Admin
            </Link>
          ) : null}
        </nav>

        {/* ── TLE OS — one quiet item pinned at the bottom; the platforms
            themselves live on its page now, not in the rail. ── */}
        <div className={`mx-4 border-t ${RAIL_LINE}`} />
        <div className="px-3 py-2">
          <Link
            href="/dashboard/tools"
            className={`${navItem} ${
              pathname.startsWith("/dashboard/tools")
                ? "font-semibold text-ink"
                : "text-muted hover:bg-black/[0.04] hover:text-ink"
            }`}
          >
            <NavIcon active={pathname.startsWith("/dashboard/tools")} name="grid" />
            TLE OS
          </Link>
        </div>

        {/* Small print, reference-style */}
        <p className="px-5 pb-5 pt-1 text-[9px] font-medium uppercase leading-relaxed tracking-[0.16em] text-muted/60">
          Partner portal
          <br />
          2026
        </p>
      </aside>

      {/* ── Mobile top bar ── */}
      <header className="sticky top-0 z-40 border-b border-line bg-white lg:hidden">
        <div className="flex h-14 items-center gap-3 px-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <BrandMark size={28} />
            <span className="text-sm font-semibold">TLE</span>
          </Link>
          <button
            onClick={() => void handleSignOut()}
            className="ml-auto rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted"
          >
            Sign out
          </button>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto px-3 pb-2">
          <NavLinks />
          <Link
            href="/dashboard/tools"
            className={`${navItem} whitespace-nowrap ${
              pathname.startsWith("/dashboard/tools")
                ? "bg-black/[0.05] font-semibold text-ink"
                : "text-muted hover:bg-black/[0.03] hover:text-ink"
            }`}
          >
            TLE OS
          </Link>
          {/* Profile has no nav slot on desktop (it's under the account chip),
              so mobile needs a way through to it. */}
          <Link
            href="/dashboard/profile"
            className={`${navItem} whitespace-nowrap ${
              pathname.startsWith("/dashboard/profile")
                ? "bg-black/[0.05] font-semibold text-ink"
                : "text-muted hover:bg-black/[0.03] hover:text-ink"
            }`}
          >
            Settings
          </Link>
        </nav>
      </header>

      {/* Top hairline across the content area — sits a little above the
          greeting, capping the page the way the rail's right line caps it. */}
      <div
        aria-hidden
        className={`fixed left-[240px] right-0 top-[56px] z-20 hidden border-t ${RAIL_LINE} lg:block`}
      />

      {/* ── Main ── */}
      <main className="dash-cards px-4 pb-12 pt-6 lg:ml-[240px] lg:px-10 lg:pt-[92px]">
        <div className="mx-auto max-w-[1600px]">
          {/* Welcome — lives in the dashboard content, big and roomy */}
          {pathname === "/dashboard" ? (
            <div
              className="enter enter-pop mb-8 pt-4 lg:mb-10 lg:pt-0"
              style={{ "--enter-delay": "600ms" } as React.CSSProperties}
            >
              {/* Light weight, Launch Pad-style — the size does the welcoming,
                  the weight stays out of the way. */}
              <h1 className="font-light tracking-tight" style={{ fontSize: "clamp(28px, 3.4vw, 42px)", lineHeight: 1.08 }}>
                {hello}
              </h1>
              <p className="mt-2.5 text-[14px] font-light text-muted lg:text-[15px]">{prompt}</p>
            </div>
          ) : null}
          {children}
        </div>
      </main>

      {/* The assistant lives in a speech bubble bottom-right, on every page —
          out of the way until it's wanted. */}
      <AssistantBubble firstName={user.name.split(" ")[0]} />

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
