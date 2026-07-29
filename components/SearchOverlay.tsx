"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Rail search — a quiet command-palette over the agent's own properties.
// Pulls their market listings and managed portfolio once per open session,
// filters as they type, and jumps straight to the property's drawer via the
// ?open=<id> param the listings/portfolio pages understand. ⌘K / Ctrl+K opens
// it from anywhere in the shell.

interface SearchItem {
  id: string;
  name: string;
  locality: string;
  address: string;
  section: "My Properties" | "My Portfolio";
  href: string;
}

export default function SearchOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Load both books on first open — cached for the overlay's lifetime.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    setQuery("");
    if (items || loading) return;
    setLoading(true);
    Promise.all([
      fetch("/api/my/listings", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/my/portfolio", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    ])
      .then(([l, p]) => {
        const out: SearchItem[] = [];
        for (const x of l?.listings ?? []) {
          out.push({
            id: x.id,
            name: x.name,
            locality: x.locality,
            address: x.address ?? `${x.name} ${x.locality}`,
            section: "My Properties",
            href: `/dashboard/listings?open=${encodeURIComponent(x.id)}`,
          });
        }
        for (const x of p?.properties ?? []) {
          out.push({
            id: x.listingId,
            name: x.name,
            locality: x.locality,
            address: x.address ?? `${x.name} ${x.locality}`,
            section: "My Portfolio",
            href: `/dashboard/portfolio?open=${encodeURIComponent(x.listingId)}`,
          });
        }
        setItems(out);
      })
      .finally(() => setLoading(false));
  }, [open, items, loading]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const results = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 8);
    return items
      .filter((i) => `${i.address} ${i.section}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [items, query]);

  const go = (item: SearchItem) => {
    onClose();
    router.push(item.href);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="menu-pop mx-auto mt-24 w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Search your properties"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <svg className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" viewBox="0 0 24 24">
            <circle cx={11} cy={11} r={7} />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) go(results[0]);
            }}
            placeholder="Search your properties…"
            className="w-full bg-transparent py-3.5 text-[14px] outline-none placeholder:text-muted/70"
          />
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[10px] text-muted sm:block">esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {loading ? (
            <p className="px-3 py-6 text-center text-[13px] text-muted">Loading your properties…</p>
          ) : results.length ? (
            results.map((item) => (
              <button
                key={`${item.section}-${item.id}`}
                type="button"
                onClick={() => go(item)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-black/[0.04]"
              >
                <svg className="h-4 w-4 shrink-0 text-muted/70" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M3 11l9-8 9 8M5 9.5V20a1 1 0 001 1h12a1 1 0 001-1V9.5" />
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{item.name}</span>
                  <span className="block truncate text-[11px] text-muted">{item.locality}</span>
                </span>
                <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted">
                  {item.section === "My Properties" ? "Market" : "Portfolio"}
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-6 text-center text-[13px] text-muted">
              {items && !items.length
                ? "No properties to search yet."
                : `Nothing matching “${query}”.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
