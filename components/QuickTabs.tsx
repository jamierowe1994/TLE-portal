"use client";

import { useEffect, useRef, useState } from "react";
import DoodleIcon from "@/components/DoodleIcon";

// The quick-cut row under a grid page's stat bar: one pill per common slice
// with its count, plus a Sort dropdown pinned right. Picking a pill drives
// the same filter the Filter dropdown does — two ways into one state.

export interface QuickTab {
  key: string;
  label: string;
  count: number;
  /** Small coloured dot before the count — flags the "needs a human" slices. */
  dot?: "amber" | "red" | "green" | "blue";
}

const DOT: Record<string, string> = {
  amber: "bg-amber-500",
  red: "bg-red-500",
  green: "bg-emerald-500",
  blue: "bg-sky-500",
};

export default function QuickTabs({
  tabs,
  value,
  onChange,
  sortOptions,
  sort,
  onSort,
}: {
  tabs: QuickTab[];
  value: string;
  onChange: (key: string) => void;
  sortOptions?: { key: string; label: string }[];
  sort?: string;
  onSort?: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const close = () => {
    setOpen(false);
    setClosing(true);
    window.setTimeout(() => setClosing(false), 240);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const activeSort = sortOptions?.find((o) => o.key === sort);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`btn-press inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[12.5px] transition ${
              on
                ? "border-ink bg-ink font-semibold text-white"
                : "border-ink/25 text-ink hover:border-ink/60"
            }`}
          >
            {!on && t.dot ? (
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[t.dot]}`} />
            ) : null}
            {t.label}
            <span className={`tnum text-[12px] ${on ? "text-white/70" : "text-muted"}`}>
              {t.count}
            </span>
          </button>
        );
      })}

      {sortOptions?.length && onSort ? (
        <div ref={ref} className="relative ml-auto">
          <button
            type="button"
            onClick={() => (open ? close() : setOpen(true))}
            className={`inline-flex items-center gap-2 rounded-xl border-[1.5px] bg-transparent px-3 py-2 text-[13px] font-medium transition ${
              open ? "border-ink/85 text-ink" : "border-ink/30 text-muted hover:border-ink/60 hover:text-ink"
            }`}
          >
            <DoodleIcon name="list" size={15} className="text-accent" />
            {activeSort?.label ?? "Sort"}
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden
              style={{ transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }}
            >
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open || closing ? (
            <div
              className={`${
                closing ? "shrink-up" : "swing-down"
              } absolute right-0 top-full z-30 mt-1.5 min-w-[180px] overflow-hidden rounded-xl border border-line bg-card p-1 shadow-lg`}
            >
              {sortOptions.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => {
                    onSort(o.key);
                    close();
                  }}
                  className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-[13px] text-ink transition hover:bg-page"
                >
                  {o.label}
                  {sort === o.key ? (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path d="M3 8.5l3.5 3.5L13 5" stroke="#e31f36" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
