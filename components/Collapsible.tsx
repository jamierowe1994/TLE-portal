"use client";

import React, { useState } from "react";
import DoodleIcon from "@/components/DoodleIcon";

interface CollapsibleProps {
  title: string;
  /** Small count/label chip shown next to the title, e.g. "4". */
  badge?: string | number;
  /** Doodle icon name (public/icons/doodle) shown before the title. */
  icon?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * A lightweight expandable section — the workhorse of the decluttered
 * dashboard. Detail (tables, secondary stats) lives collapsed by default so
 * the page stays digestible; the agent opens only what they want.
 */
export default function Collapsible({
  title,
  badge,
  icon,
  defaultOpen = false,
  children,
}: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-black/[0.015]"
      >
        {icon ? <DoodleIcon name={icon} size={17} className="text-muted" /> : null}
        <span className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          {title}
        </span>
        {badge != null && badge !== "" ? (
          <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-semibold tnum text-ink">
            {badge}
          </span>
        ) : null}
        <svg
          className="ml-auto shrink-0 text-muted transition-transform duration-300"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="fade-up border-t border-line px-5 py-4">{children}</div>
      ) : null}
    </div>
  );
}
