"use client";

import { useEffect } from "react";

// The two-window drawer: separate white boxes floating on the faded page,
// centred, tops aligned. Left is "the thing", right is "what to do about it" —
// the split that keeps a busy record from reading as one long scroll.
//
// The close button deliberately sits OFF the boxes, floating on the backdrop:
// the boxes stay clean, and the whole surround is already click-to-close
// anyway — the X is just the visible affordance for it.

export function DrawerPanel({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  /** Inline sizing (e.g. a fixed width) — beats any utility-class ordering. */
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`modal-pop w-full rounded-2xl bg-card ${className}`}
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

export default function SplitDrawer({
  onClose,
  children,
  hideClose = false,
}: {
  onClose: () => void;
  children: React.ReactNode;
  /** Drawers with their own action rail supply the close button themselves. */
  hideClose?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div className="flex min-h-full items-center justify-center p-4 py-10 sm:p-10">
        <div className="relative">
<button
            onClick={onClose}
            aria-label="Close"
            className={`absolute -top-2 right-0 z-10 -translate-y-full rounded-full bg-white/15 p-2 text-white backdrop-blur-sm transition hover:bg-white/30 sm:-right-2 sm:top-0 sm:translate-x-full sm:translate-y-0 ${
              hideClose ? "lg:hidden" : ""
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>

          {/* items-start keeps the two boxes top-aligned even when one runs long */}
          <div className="flex flex-col items-start gap-4 lg:flex-row">{children}</div>
        </div>
      </div>
    </div>
  );
}
