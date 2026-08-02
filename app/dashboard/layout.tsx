"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import AssistantBubble from "@/components/AssistantBubble";
import FontSwitcher from "@/components/FontSwitcher";
import SearchOverlay from "@/components/SearchOverlay";
import DoodleIcon from "@/components/DoodleIcon";
import Loader from "@/components/Loader";
import { refreshUser, signOut } from "@/lib/session";
import { PLATFORMS } from "@/lib/platforms";
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
const RAIL_LINE = "border-black/[0.16]";

// Two columns leave about eleven characters per chip, so a name that would
// otherwise ellipsise can give the rail a shorter label than the copy its
// tools-page card uses. "Training platform" reads fine as a card title and
// terribly as "Training pl…".
const CHIP_LABEL: Record<string, string> = { training: "Training" };

// TLE OS launcher. There's no "All tools →" chip any more — the grid is apps
// only — which is why it reads the whole registry rather than the "platforms"
// slice, and why the registry is the only list. Adding an app is one entry in
// lib/platforms.ts and it shows up in both the rail and /dashboard/tools.
const LAUNCHER = PLATFORMS.map((a) => ({ name: CHIP_LABEL[a.id] ?? a.name, url: a.url }));

const CHIP_COLS = 2;
const CHIP_ROWS = Math.ceil(LAUNCHER.length / CHIP_COLS);

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

// A time-of-day welcome with a little personality — the wording shifts with
// the hour, and the block keeps generous room above it.
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
  // Kept mounted briefly on close so it can shrink upwards before unmounting.
  const [menuClosing, setMenuClosing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // TLE OS spring box: open pops the brand chips up; closing keeps them
  // mounted just long enough to tumble back down behind the line.
  const [tleOpen, setTleOpen] = useState(false);
  const [tleClosing, setTleClosing] = useState(false);
  // Page transition: nav clicks drop the current page out of the bottom of
  // the screen, then navigate; the new page rises back up (keyed wrapper).
  const [dropping, setDropping] = useState(false);
  const dropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Warm the destination's API while the transition plays (and on hover) so
  // the page lands with its data already cached server-side.
  const PREFETCH: Record<string, string[]> = {
    "/dashboard": ["/api/my/stats?month=2026-07", "/api/my/forecast?month=2026-07"],
    "/dashboard/todos": ["/api/my/todos"],
    "/dashboard/listings": ["/api/my/listings"],
    "/dashboard/applications": ["/api/my/applications"],
    "/dashboard/compliance": ["/api/my/compliance"],
    "/dashboard/portfolio": ["/api/my/portfolio"],
  };
  const warmed = useRef<Record<string, number>>({});
  const warm = (href: string) => {
    const urls = PREFETCH[href];
    if (!urls) return;
    const now = Date.now();
    if (warmed.current[href] && now - warmed.current[href] < 30_000) return;
    warmed.current[href] = now;
    for (const u of urls) fetch(u, { cache: "no-store" }).catch(() => {});
  };

  const navTo = (href: string) => {
    if (href === pathname || dropping) return;
    warm(href);
    setDropping(true);
    if (dropTimer.current) clearTimeout(dropTimer.current);
    // Push once the drop has played; `dropping` stays true (page held off
    // screen) until the pathname actually changes, so a slow route can't
    // flash the old page back mid-transition.
    dropTimer.current = setTimeout(() => router.push(href), 560);
  };

  useEffect(() => {
    setDropping(false);
    // Every page starts from the top — no inheriting the last page's scroll.
    window.scrollTo(0, 0);
  }, [pathname]);

  const toggleTle = () => {
    if (tleOpen) {
      setTleOpen(false);
      setTleClosing(true);
      setTimeout(() => setTleClosing(false), 600);
    } else {
      setTleClosing(false);
      setTleOpen(true);
    }
  };

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

  const closeMenu = () => {
    setMenuOpen(false);
    setMenuClosing(true);
    setTimeout(() => setMenuClosing(false), 240);
  };

  // Close the account menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
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

  useEffect(() => {
    setMenuOpen(false);
    setMenuClosing(false);
  }, [pathname]);

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  if (checking || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--page)" }}>
        <Loader label="Checking your session…" />
      </div>
    );
  }

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
  // TLE OS isn't in NAV, so its active state is read by hand — in three places
  // (the rail toggle, the rail's link through to the page, the mobile item).
  const toolsActive = isActive("/dashboard/tools");
  const { hello, prompt } = greeting(user.name);
  // Clicking the illustration flicks through the other times of day — a

  // Reference-style items with hand-drawn doodle icons — no tiles, no pills.
  // The active one simply goes deeper black and a touch bolder; everything
  // else sits back in grey until you're looking for it.
  const navItem =
    "flex items-center gap-3 rounded-md px-2.5 py-2 text-[14px] transition-colors";
  // The main destinations get more presence than the utility rows above them.
  const navItemLg =
    "flex items-center gap-3.5 rounded-md px-2.5 py-2.5 text-[15.5px] transition-colors";

  const NavIcon = ({ active, name, size = 19 }: { active: boolean; name: string; size?: number }) => (
    <DoodleIcon
      name={name}
      size={size}
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
            onClick={(e) => {
              e.preventDefault();
              onNavigate?.();
              navTo(item.href);
            }}
            onMouseEnter={() => warm(item.href)}
            className={`${navItemLg} ${
              active
                ? "font-semibold text-ink"
                : "text-muted hover:bg-black/[0.04] hover:text-ink"
            }`}
          >
            <NavIcon active={active} name={item.icon} size={23} />
            {item.label}
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="type-agent relative min-h-screen" style={{ background: "var(--page)" }}>
      {/* ── Desktop sidebar — grey on grey, broken up by darker hairlines and
          capped off by its own right-hand line ── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[240px] flex-col border-r border-ink/40 lg:flex">
        {/* Account selector, top of the rail — photo, name, dropdown. Just an
            outline in the same hairline grey; no fill. */}
        <div className="relative mt-5 px-3" ref={menuRef}>
          <button
            type="button"
            onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={`flex w-full items-center gap-3 rounded-lg border ${RAIL_LINE} px-4 py-3 text-left transition hover:bg-white/60 ${
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

          {menuOpen || menuClosing ? (
            <div className={`${menuClosing ? "shrink-up" : "swing-down"} absolute left-3 right-3 top-[calc(100%+0.25rem)] z-50 overflow-hidden rounded-xl border border-line bg-card p-1 shadow-xl`}>
              <Link
                href="/dashboard/profile"
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-ink transition hover:bg-black/[0.04]"
              >
                <DoodleIcon name="setting" size={17} className="text-muted" />
                Profile
              </Link>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-muted transition hover:bg-black/[0.04] hover:text-ink"
              >
                <DoodleIcon name="logout" size={17} />
                Sign out
              </button>
            </div>
          ) : null}
        </div>

        {/* Notifications + search, reference-style, above the first divider */}
        <div className="mt-7 space-y-0.5 px-3">
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

        {/* The one shrinkable child of the rail: everything below is shrink-0
            or floored at its content height, so a short viewport has to come
            out of here. grow/basis-auto rather than flex-1 because a zero
            basis makes this nav's scaled shrink factor zero — nothing would
            take the deficit and the rail would simply overflow. An auto basis
            lets it absorb the squeeze and scroll, which is what its
            overflow-y-auto was always there for. */}
        <nav className="mt-3 min-h-0 grow basis-auto space-y-0.5 overflow-y-auto px-3">
          <NavLinks />
        </nav>

        {/* ── TLE OS — one quiet item pinned at the bottom. Clicking it throws
            the brand chips up from behind the line (spring box); clicking
            again tumbles them back down behind it. ── */}
        {tleOpen || tleClosing ? (
          <div className="shrink-0 overflow-hidden px-3">
            {/* Two columns, not one: at eight apps a single stack is taller
                than the rail has left, and the box is overflow-hidden, so the
                bottom chips would be silently clipped rather than scroll. */}
            <div className="grid grid-cols-2 gap-1.5 pb-2">
              {LAUNCHER.map((c, i) => {
                // Alternating tilts + uneven delays = thrown in the air,
                // knocking about, landing in place. --travel is each chip's
                // distance past the bottom line, so every chip rises from
                // behind it and falls fully back behind it — the top row
                // travels the furthest, no fading. Travel is per ROW, not per
                // chip: two chips side by side have to set off from the same
                // height or the row arrives crooked. The delays stay per chip
                // — that mismatch is the knocking-about.
                const tilt = [-7, 6, -5, 8, -6, 5, -8, 4][i % 8];
                const delay = [0, 70, 35, 105, 55, 120, 20, 90][i % 8];
                const travel = (CHIP_ROWS - Math.floor(i / CHIP_COLS)) * 38 + 24;
                // truncate does double duty: it ellipsises the long names and,
                // by clipping overflow, stops one of them widening its grid
                // track past the 240px rail.
                const cls = `${tleClosing ? "chip-fall" : "chip-pop"} block min-w-0 truncate rounded-lg border ${RAIL_LINE} bg-white/70 px-2.5 py-1.5 text-[12.5px] font-medium`;
                const style = {
                  "--tilt": `${tilt}deg`,
                  "--delay": `${delay}ms`,
                  "--travel": `${travel}px`,
                } as React.CSSProperties;
                if (!c.url) {
                  return (
                    <span key={c.name} title={`${c.name} — link coming`} className={`${cls} cursor-default text-muted/50`} style={style}>
                      {c.name}
                    </span>
                  );
                }
                // Every app in the rail lives outside the portal, so there's
                // no internal-route branch left — add one back if that stops
                // being true rather than sending a portal page to a new tab.
                return (
                  <a
                    key={c.name}
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={c.name}
                    className={`${cls} text-ink transition hover:bg-white`}
                    style={style}
                  >
                    {c.name}
                  </a>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className={`mx-4 border-t ${RAIL_LINE}`} />
        {/* Two controls, not one: the label toggles the chip box, and "All"
            goes to /dashboard/tools. The box only ever holds apps now, so
            without this link the page has no desktop entry point at all —
            the mobile bar's TLE OS item is inside a lg:hidden header. */}
        <div className="flex items-center px-3 py-2">
          <button
            type="button"
            onClick={toggleTle}
            aria-expanded={tleOpen}
            className={`${navItem} min-w-0 flex-1 ${
              tleOpen || toolsActive
                ? "font-semibold text-ink"
                : "text-muted hover:bg-black/[0.04] hover:text-ink"
            }`}
          >
            <NavIcon active={tleOpen || toolsActive} name="grid" />
            TLE OS
            <svg
              className={`ml-auto h-3 w-3 text-muted transition-transform duration-200 ${tleOpen ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
          <Link
            href="/dashboard/tools"
            onClick={(e) => {
              e.preventDefault();
              navTo("/dashboard/tools");
            }}
            title="All tools"
            className={`shrink-0 rounded-md px-2 py-2 text-[12px] transition-colors ${
              toolsActive
                ? "font-semibold text-ink"
                : "text-muted hover:bg-black/[0.04] hover:text-ink"
            }`}
          >
            All
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
              toolsActive
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
            Profile
          </Link>
        </nav>
      </header>

      {/* ── Main ── */}
      {/* Deliberately NOT its own stacking context: drawer overlays (z-50)
          have to be able to cover the nav rail (z-30). */}
      <main
        className={`dash-cards px-4 pb-12 pt-6 lg:ml-[240px] lg:px-10 lg:pt-12 ${
          dropping ? "page-drop" : ""
        }`}
      >
        <div key={pathname} className="page-rise mx-auto max-w-[1600px]">
          {/* Welcome — lives in the dashboard content, big and roomy */}
          {pathname === "/dashboard" ? (
            <div
              className="enter enter-pop mb-6 pt-4 lg:mb-6 lg:pt-0"
              style={{ "--enter-delay": "600ms" } as React.CSSProperties}
            >
              {/* The greeting keeps the room the artwork used to fill — the
                  block height is deliberate white space, not a leftover. */}
              <div className="flex items-end gap-4 pt-2 lg:min-h-[236px]">
                <div className="min-w-0 pb-5 lg:pb-14">
                  <h1 className="w-fit tracking-tight" style={{ fontSize: "clamp(32px, 4vw, 52px)", lineHeight: 1.08, fontWeight: 300 }}>
                    {hello}
                  </h1>
                  <p className="mt-2.5 text-[14px] font-light text-muted lg:text-[15px]">{prompt}</p>
                </div>
              </div>
            </div>
          ) : null}
          {children}
        </div>
      </main>

      {/* The assistant lives in a speech bubble bottom-right, on every page —
          out of the way until it's wanted. */}
      <AssistantBubble firstName={user.name.split(" ")[0]} />

      {/* Corner control for trialling the portal's type. */}
      <FontSwitcher />

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
