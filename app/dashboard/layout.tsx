"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import AssistantBubble from "@/components/AssistantBubble";
import SearchOverlay from "@/components/SearchOverlay";
import DoodleIcon from "@/components/DoodleIcon";
import Loader from "@/components/Loader";
import { refreshUser, signOut } from "@/lib/session";
import { platformsIn } from "@/lib/platforms";
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

// A time-of-day welcome with a little personality — and matching artwork.
// The doodle lady changes with the hour (public/illustrations), and each
// piece carries a small animation: the wavers rock into a wave, the evening
// scribble jitters, the night Zs bob. Overlay positions are percentages of
// the base image, emitted by the split-layers script that cut them apart.
interface ArtSpec {
  base: string;
  /** Animation class applied to the whole figure. */
  anim?: string;
  overlay?: { src: string; left: string; top: string; width: string; anim: string };
  /** Landscape art (the sleeper) renders shorter so it doesn't dominate. */
  wide?: boolean;
  /** Padding classes making room for overlays that float above the figure. */
  headroom?: string;
}

const ART: Record<"morning" | "wave" | "evening" | "night", ArtSpec> = {
  morning: { base: "/illustrations/tle-morning.png", anim: "art-wave" },
  wave: { base: "/illustrations/tle-wave.png", anim: "art-wave" },
  evening: {
    base: "/illustrations/tle-evening-base.png",
    overlay: { src: "/illustrations/tle-evening-scribble.png", left: "-9.6%", top: "-21.8%", width: "37.8%", anim: "art-scribble" },
    headroom: "pt-8 lg:pt-10",
  },
  night: {
    base: "/illustrations/tle-night-base.png",
    overlay: { src: "/illustrations/tle-night-zs.png", left: "55.1%", top: "-27.4%", width: "35.9%", anim: "art-zs" },
    headroom: "pt-10 lg:pt-12",
  },
};

type ArtKey = keyof typeof ART;
const ART_ORDER: ArtKey[] = ["morning", "wave", "evening", "night"];

function greeting(name: string): { hello: string; prompt: string; artKey: ArtKey } {
  const first = name.split(" ")[0] || name;
  const h = new Date().getHours();
  if (h < 5) return { hello: `Still up, ${first}?`, prompt: "Burning the midnight oil — don't work too hard.", artKey: "night" };
  if (h < 7) return { hello: `Morning, ${first}`, prompt: "You're an early riser — let's make it count.", artKey: "morning" };
  if (h < 12) return { hello: `Good morning, ${first}`, prompt: "Here's where you're at today.", artKey: "morning" };
  if (h < 17) return { hello: `Good afternoon, ${first}`, prompt: "Hope the day's going your way.", artKey: "wave" };
  if (h < 21) return { hello: `Good evening, ${first}`, prompt: "Winding down — here's your day.", artKey: "evening" };
  return { hello: `Evening, ${first}`, prompt: "Late one? Here's the latest.", artKey: "night" };
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
  const [artPreview, setArtPreview] = useState<ArtKey | null>(null);
  // Page transition: nav clicks drop the current page out of the bottom of
  // the screen, then navigate; the new page rises back up (keyed wrapper).
  const [dropping, setDropping] = useState(false);
  const dropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const navTo = (href: string) => {
    if (href === pathname || dropping) return;
    setDropping(true);
    if (dropTimer.current) clearTimeout(dropTimer.current);
    // Push once the drop has played; `dropping` stays true (page held off
    // screen) until the pathname actually changes, so a slow route can't
    // flash the old page back mid-transition.
    dropTimer.current = setTimeout(() => router.push(href), 380);
  };

  useEffect(() => {
    setDropping(false);
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
  const { hello, prompt, artKey } = greeting(user.name);
  // Clicking the illustration flicks through the other times of day — a
  // little easter egg that doubles as the way to preview all the art.
  const shownKey = artPreview ?? artKey;
  const art = ART[shownKey];

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
            onClick={(e) => {
              e.preventDefault();
              onNavigate?.();
              navTo(item.href);
            }}
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
            onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
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

          {menuOpen || menuClosing ? (
            <div className={`${menuClosing ? "shrink-up" : "swing-down"} absolute left-3 right-3 top-[calc(100%+0.25rem)] z-50 overflow-hidden rounded-xl border border-line bg-card p-1 shadow-xl`}>
              <Link
                href="/dashboard/profile"
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-ink transition hover:bg-black/[0.04]"
              >
                <DoodleIcon name="setting" size={17} className="text-muted" />
                Settings
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

        {/* ── TLE OS — one quiet item pinned at the bottom. Clicking it throws
            the brand chips up from behind the line (spring box); clicking
            again tumbles them back down behind it. ── */}
        {tleOpen || tleClosing ? (
          <div className="overflow-hidden px-3">
            <div className="flex flex-col gap-1.5 pb-2">
              {[
                { name: "All tools →", url: "/dashboard/tools", external: false },
                ...platformsIn("platforms").map((p) => ({
                  name: p.name,
                  url: p.url,
                  external: true,
                })),
              ].map((c, i, arr) => {
                // Alternating tilts + uneven delays = thrown in the air,
                // knocking about, landing in place. --travel is each chip's
                // distance past the bottom line, so every chip rises from
                // behind it and falls fully back behind it — the top chip
                // travels the furthest, no fading.
                const tilt = [-7, 6, -5, 8, -6, 5, -8, 4][i % 8];
                const delay = [0, 70, 35, 105, 55, 120, 20, 90][i % 8];
                const travel = (arr.length - i) * 38 + 24;
                const cls = `${tleClosing ? "chip-fall" : "chip-pop"} flex items-center rounded-lg border ${RAIL_LINE} bg-white/70 px-3 py-1.5 text-[12.5px] font-medium`;
                const style = {
                  "--tilt": `${tilt}deg`,
                  "--delay": `${delay}ms`,
                  "--travel": `${travel}px`,
                } as React.CSSProperties;
                if (!c.url) {
                  return (
                    <span key={c.name} title="Link coming" className={`${cls} cursor-default text-muted/50`} style={style}>
                      {c.name}
                    </span>
                  );
                }
                return c.external ? (
                  <a
                    key={c.name}
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${cls} text-ink transition hover:bg-white`}
                    style={style}
                  >
                    {c.name}
                  </a>
                ) : (
                  <Link key={c.name} href={c.url} className={`${cls} text-ink transition hover:bg-white`} style={style}>
                    {c.name}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className={`mx-4 border-t ${RAIL_LINE}`} />
        <div className="px-3 py-2">
          <button
            type="button"
            onClick={toggleTle}
            aria-expanded={tleOpen}
            className={`${navItem} w-full ${
              tleOpen || pathname.startsWith("/dashboard/tools")
                ? "font-semibold text-ink"
                : "text-muted hover:bg-black/[0.04] hover:text-ink"
            }`}
          >
            <NavIcon active={tleOpen || pathname.startsWith("/dashboard/tools")} name="grid" />
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
      <main
        className={`dash-cards px-4 pb-12 pt-6 lg:ml-[240px] lg:px-10 lg:pt-[92px] ${
          dropping ? "page-drop" : ""
        }`}
      >
        <div key={pathname} className="page-rise mx-auto max-w-[1600px]">
          {/* Welcome — lives in the dashboard content, big and roomy */}
          {pathname === "/dashboard" ? (
            <div
              className="enter enter-pop mb-8 pt-4 lg:mb-10 lg:pt-0"
              style={{ "--enter-delay": "600ms" } as React.CSSProperties}
            >
              {/* Light weight, Launch Pad-style — the size does the welcoming,
                  the weight stays out of the way. The doodle lady waves from
                  behind the line that closes the greeting off. */}
              {/* The lady fills the band between the top line and the greeting's
                  own line — big, sat over where the period buttons live below,
                  and her bottom edge tucked past the border so the artwork's
                  cut-off is never visible: the line does the cropping. */}
              <div className="flex items-end gap-4 overflow-hidden border-b border-black/[0.08] pt-2">
                <div className="min-w-0 pb-5">
                  <h1 className="font-light tracking-tight" style={{ fontSize: "clamp(28px, 3.4vw, 42px)", lineHeight: 1.08 }}>
                    {hello}
                  </h1>
                  <p className="mt-2.5 text-[14px] font-light text-muted lg:text-[15px]">{prompt}</p>
                </div>
                <button
                  type="button"
                  key={shownKey}
                  onClick={() =>
                    setArtPreview(ART_ORDER[(ART_ORDER.indexOf(shownKey) + 1) % ART_ORDER.length])
                  }
                  title="Flick through the other times of day"
                  aria-label="Preview the other times of day"
                  className={`rise-in -mb-2 ml-auto mr-2 shrink-0 cursor-pointer self-end outline-none sm:mr-12 lg:mr-24 ${art.headroom ?? ""}`}
                  style={{ "--enter-delay": artPreview ? "0ms" : "950ms" } as React.CSSProperties}
                >
                  {/* Overlay percentages are relative to the image box, so the
                      positioning wrapper hugs the img exactly; headroom for
                      overlays that float above (the Zs) lives on the button. */}
                  <span className="relative block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={art.base}
                      alt=""
                      className={`w-auto ${art.wide ? "h-16 lg:h-24" : "h-32 lg:h-[172px]"} ${art.anim ?? ""}`}
                    />
                    {art.overlay ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={art.overlay.src}
                        alt=""
                        className={`absolute ${art.overlay.anim}`}
                        style={{ left: art.overlay.left, top: art.overlay.top, width: art.overlay.width }}
                      />
                    ) : null}
                  </span>
                </button>
              </div>
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
