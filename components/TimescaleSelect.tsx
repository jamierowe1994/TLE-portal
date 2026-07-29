"use client";

import { useEffect, useRef, useState } from "react";

// A slick timescale picker for the My Ads overview — a curved pill button that
// drops a rounded, soft-shadowed menu. Closes on outside-click or Escape.

export interface TimescaleOption {
  id: string;
  label: string;
}

export default function TimescaleSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: readonly TimescaleOption[];
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = options.find((o) => o.id === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="btn-press flex items-center gap-2 rounded-xl border border-line bg-card px-3.5 py-2 text-[13px] font-medium text-ink shadow-sm transition hover:border-black/20 disabled:opacity-50"
      >
        <svg className="h-3.5 w-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <rect x={3} y={4.5} width={18} height={16} rx={2.5} />
          <path d="M3 9h18M8 3v3M16 3v3" />
        </svg>
        <span>{current?.label}</span>
        <svg className={`h-3.5 w-3.5 text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          className="menu-pop absolute right-0 z-50 mt-2 min-w-[172px] origin-top-right overflow-hidden rounded-xl border border-line bg-card p-1 shadow-xl"
          style={{ boxShadow: "0 12px 32px rgba(16,16,20,0.14), 0 2px 8px rgba(16,16,20,0.08)" }}
        >
          {options.map((o) => {
            const active = o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition ${
                  active ? "bg-black/[0.06] font-semibold text-ink" : "text-ink hover:bg-black/[0.04]"
                }`}
              >
                {o.label}
                {active ? (
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
