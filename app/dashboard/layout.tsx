"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import { refreshUser, signOut } from "@/lib/session";
import { BRAND } from "@/lib/brand";
import type { UserProfile } from "@/lib/types";

// Agent dashboard shell — a CRM-style layout: a fixed left nav rail and a top
// bar joined by one seamless white "chrome" surface with a concave swoop, a
// time-of-day welcome, and full-width content. Modelled on the sister TEG
// portal's layout.

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" },
  { href: "/dashboard/ads", label: "My Ads", icon: "M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zm2 11l4-5 3 3 2-2 3 4M9 9.5a.5.5 0 11-1 0 .5.5 0 011 0z" },
  { href: "/dashboard/forecast", label: "Forecast", icon: "M3 17l6-6 4 4 8-8M21 7v6M21 7h-6" },
  { href: "/dashboard/profile", label: "Profile", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
];

const SIDEBAR_W = 240;
const TOPBAR_H = 68;
const SWOOP = 22;

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

// One seamless white L-shape (sidebar + top bar) with a concave corner swoop.
function ChromeSurface({ vw, vh }: { vw: number; vh: number }) {
  const sw = SIDEBAR_W;
  const th = TOPBAR_H;
  const r = SWOOP;
  const d =
    `M0 0 L${vw} 0 L${vw} ${th} L${sw + r} ${th} ` +
    `A${r} ${r} 0 0 0 ${sw} ${th + r} L${sw} ${vh} L0 ${vh} Z`;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-20 hidden bg-white lg:block"
      style={{
        clipPath: `path('${d}')`,
        WebkitClipPath: `path('${d}')`,
        filter: "drop-shadow(3px 0 12px rgba(0,0,0,0.05)) drop-shadow(0 4px 12px rgba(0,0,0,0.05))",
      }}
    />
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [checking, setChecking] = useState(true);
  const [vp, setVp] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

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

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <>
      {NAV.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active ? "accent-soft-bg text-ink" : "text-muted hover:bg-black/[0.03] hover:text-ink"
            }`}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
              style={active ? { color: BRAND.accent } : undefined}
            >
              <path d={item.icon} />
            </svg>
            {item.label}
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="relative min-h-screen" style={{ background: "var(--page)" }}>
      {/* ambient glow */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col lg:flex">
        <div className="flex items-center gap-2.5 px-5 pt-6">
          <BrandMark size={34} />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">The Lettings Expert</div>
            <div className="text-[10px] uppercase tracking-wide text-muted">Partner Portal</div>
          </div>
        </div>

        <nav className="mt-8 flex-1 space-y-0.5 px-3">
          <NavLinks />
          {user.isAdmin ? (
            <Link
              href="/admin"
              className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:bg-black/[0.03] hover:text-ink"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.24.58.78.98 1.42 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Admin
            </Link>
          ) : null}
        </nav>

        <div className="p-4">
          <div className="flex items-center gap-3">
            {user.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.photo} alt={user.name} className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full accent-soft-bg text-[12px] font-semibold accent-text">
                {initials(user.name) || "?"}
              </span>
            )}
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Desktop top bar (welcome + sign out) ── */}
      <header className="fixed right-0 top-0 z-40 hidden h-[68px] items-center justify-between gap-3 pl-6 pr-8 lg:flex" style={{ left: SIDEBAR_W }}>
        <div className="min-w-0">
          <p className="truncate text-[17px] font-semibold leading-tight tracking-tight">{hello} 👋</p>
          <p className="truncate text-[12.5px] text-muted">{prompt}</p>
        </div>
        <button
          onClick={() => void handleSignOut()}
          className="btn-press shrink-0 rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium text-muted transition hover:text-ink"
        >
          Sign out
        </button>
      </header>

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
        </nav>
      </header>

      {/* ── Main ── */}
      <main className="dash-cards px-4 pb-12 pt-4 lg:ml-[240px] lg:px-8 lg:pt-[96px]">
        {/* Mobile welcome */}
        <div className="mb-4 lg:hidden">
          <p className="text-[17px] font-semibold leading-tight">{hello} 👋</p>
          <p className="text-[12.5px] text-muted">{prompt}</p>
        </div>
        <div className="mx-auto max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
