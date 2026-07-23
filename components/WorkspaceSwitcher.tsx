"use client";

// Top-left workspace switcher — one login, several hats. Susan (admin) flips
// between the Business admin dashboard and the Pre-Tenancy board from the
// brand corner; anyone with a single workspace just sees the static brand
// block (no chevron, no menu).

import { useState } from "react";
import BrandMark from "@/components/BrandMark";
import type { UserProfile } from "@/lib/types";

export type WorkspaceKey = "admin" | "pretenancy";

const WORKSPACES: { key: WorkspaceKey; label: string; caption: string; href: string }[] = [
  { key: "admin", label: "Business", caption: "Susan's admin dashboard", href: "/admin" },
  { key: "pretenancy", label: "Pre-Tenancy", caption: "Every move-in, every agent", href: "/pretenancy" },
];

function available(user: UserProfile): typeof WORKSPACES {
  return WORKSPACES.filter((w) =>
    w.key === "admin" ? !!user.isAdmin : !!user.isAdmin || !!user.isPreTenancy
  );
}

export default function WorkspaceSwitcher({
  user,
  current,
  size = 34,
}: {
  user: UserProfile;
  current: WorkspaceKey;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const options = available(user);
  const active = WORKSPACES.find((w) => w.key === current)!;
  const switchable = options.length > 1;

  const block = (
    <div className="flex items-center gap-2.5 text-left">
      <BrandMark size={size} />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[15px] font-semibold tracking-tight">
          The Lettings Expert
        </div>
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted">
          {active.label}
          {switchable ? (
            <svg
              viewBox="0 0 24 24"
              className={`h-2.5 w-2.5 transition ${open ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          ) : null}
        </div>
      </div>
    </div>
  );

  if (!switchable) return block;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn-press rounded-xl px-1 py-0.5 transition hover:bg-page"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {block}
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="menu-pop absolute left-0 z-50 mt-1.5 w-64 rounded-xl border border-line bg-card p-1.5 shadow-lg">
            {options.map((w) => (
              <a
                key={w.key}
                href={w.href}
                aria-current={w.key === current ? "page" : undefined}
                className={`block rounded-lg px-3 py-2 transition hover:bg-page ${
                  w.key === current ? "bg-page" : ""
                }`}
              >
                <span className="flex items-center justify-between text-[13px] font-semibold">
                  {w.label}
                  {w.key === current ? (
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  ) : null}
                </span>
                <span className="block text-[11px] text-muted">{w.caption}</span>
              </a>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
