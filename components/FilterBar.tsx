"use client";

import { useEffect, useRef, useState } from "react";
import DoodleIcon from "@/components/DoodleIcon";

// Filter + search controls for the tile-grid pages, sat on the right of the
// summary line. Same language as the dashboard's period pills: outline-only
// boxes on the eggshell, dropdown swings open and zips shut. The search is
// just the icon until clicked — then it springs outwards, shoving the Filter
// pill along with it.

export interface FilterOption {
  key: string;
  label: string;
}

const pillClass = (active: boolean) =>
  `inline-flex items-center gap-2 rounded-xl border-[1.5px] bg-transparent px-3 py-2 text-[13px] font-medium transition ${
    active
      ? "border-ink/85 text-ink"
      : "border-ink/30 text-muted hover:border-ink/60 hover:text-ink"
  }`;

function Chevron({ open }: { open?: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }}
    >
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function FilterBar({
  options,
  value,
  onChange,
  search,
  onSearch,
  placeholder = "Search properties…",
}: {
  options: FilterOption[];
  value: string;
  onChange: (key: string) => void;
  search: string;
  onSearch: (q: string) => void;
  placeholder?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [knock, setKnock] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  const closeMenu = () => {
    if (!menuOpen) return;
    setMenuOpen(false);
    setMenuClosing(true);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setMenuClosing(false), 240);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen]);

  const active = options.find((o) => o.key === value);
  const filtering = value !== options[0]?.key;

  const openSearch = () => {
    setSearchOpen(true);
    setKnock(true);
    // Focus once the spring has started moving.
    window.setTimeout(() => input.current?.focus(), 80);
  };
  const collapseSearchIfEmpty = () => {
    if (!search.trim()) setSearchOpen(false);
  };

  const check = (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5l3.5 3.5L13 5" stroke="#e31f36" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <div ref={wrap} className="flex items-center gap-2">
      {/* ---- Filter pill + swing-down menu (gets knocked by the search bubble) ---- */}
      <div className={`relative ${knock ? "filter-knock" : ""}`} onAnimationEnd={() => setKnock(false)}>
        <button
          type="button"
          className={pillClass(filtering || menuOpen)}
          onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
          aria-expanded={menuOpen}
        >
          <DoodleIcon name="list" size={15} />
          <span>{filtering && active ? active.label : "Filter"}</span>
          <Chevron open={menuOpen} />
        </button>
        {menuOpen || menuClosing ? (
          <div
            className={`${
              menuClosing ? "shrink-up" : "swing-down"
            } absolute right-0 top-full z-30 mt-1.5 min-w-[196px] overflow-hidden rounded-xl border border-line bg-card p-1 shadow-lg`}
          >
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => {
                  onChange(o.key);
                  closeMenu();
                }}
                className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-[13px] text-ink transition hover:bg-page"
              >
                {o.label}
                {value === o.key ? check : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* ---- Search: a circle that morphs into a box and springs outwards ---- */}
      <div
        className={`flex items-center overflow-hidden border-[1.5px] bg-transparent transition-colors ${
          searchOpen || search ? "border-ink/85" : "border-ink/30 hover:border-ink/60"
        }`}
        style={{
          borderRadius: searchOpen || search ? 12 : 999,
          transition: "border-radius 0.35s ease, border-color 0.2s",
        }}
      >
        <button
          type="button"
          aria-label={searchOpen ? "Close search" : "Search properties"}
          onClick={() => {
            if (searchOpen) {
              onSearch("");
              setSearchOpen(false);
            } else openSearch();
          }}
          className={`p-2 transition ${searchOpen || search ? "text-ink" : "text-muted hover:text-ink"}`}
        >
          <DoodleIcon name="search" size={17} />
        </button>
        {/* Width springs open with a proper overshoot, shoving the pills leftwards. */}
        <div
          style={{
            width: searchOpen ? 190 : 0,
            transition: "width 0.55s cubic-bezier(0.3, 1.45, 0.45, 1)",
          }}
        >
          <input
            ref={input}
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onBlur={collapseSearchIfEmpty}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onSearch("");
                setSearchOpen(false);
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder={placeholder}
            className="w-[190px] bg-transparent py-2 pr-3 text-[13px] text-ink outline-none placeholder:text-muted"
          />
        </div>
      </div>
    </div>
  );
}
