"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import { PresentProvider } from "@/components/PresentMode";
import { refreshUser, signOut } from "@/lib/session";
import { BRAND } from "@/lib/brand";
import type { UserProfile } from "@/lib/types";

// Agent dashboard shell — TEG pattern: client-side guard (re-validate the
// session on mount, bounce to /login when it's gone), top nav with the brand
// mark + section links, user chip + sign out. The nav and footer carry
// "hide-when-presenting" so presentation mode strips the chrome.

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/ads", label: "My Ads" },
  { href: "/dashboard/forecast", label: "Forecast" },
  { href: "/dashboard/profile", label: "Profile" },
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [checking, setChecking] = useState(true);

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
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted">
          <BrandMark size={28} />
          <span>Checking your session…</span>
        </div>
      </div>
    );
  }

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  return (
    <PresentProvider>
      <div className="flex min-h-screen flex-col">
        <header className="hide-when-presenting sticky top-0 z-30 border-b border-line bg-card">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <BrandMark size={34} />
              <span className="hidden text-sm font-semibold tracking-tight sm:block">
                {BRAND.name}
              </span>
            </Link>

            <nav className="ml-2 flex items-center gap-1 overflow-x-auto sm:ml-6">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                    isActive(link.href)
                      ? "accent-soft-bg accent-text"
                      : "text-muted hover:bg-gray-50 hover:text-ink"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-3">
              <Link
                href="/dashboard/profile"
                className="flex items-center gap-2"
                title="Your profile"
              >
                {user.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.photo}
                    alt={user.name}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full accent-soft-bg text-[11px] font-semibold accent-text">
                    {initials(user.name) || "?"}
                  </span>
                )}
                <span className="hidden max-w-[140px] truncate text-[13px] font-medium md:block">
                  {user.name}
                </span>
              </Link>
              <button
                onClick={handleSignOut}
                className="btn-press rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-muted transition hover:text-ink"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>

        <footer className="hide-when-presenting border-t border-line">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 text-[11px] text-muted sm:px-6">
            <span>
              © {new Date().getFullYear()} {BRAND.name} · Partner Portal
            </span>
            {user.isAdmin ? (
              <Link href="/admin" className="transition hover:text-ink">
                Admin
              </Link>
            ) : (
              <span />
            )}
          </div>
        </footer>
      </div>
    </PresentProvider>
  );
}
