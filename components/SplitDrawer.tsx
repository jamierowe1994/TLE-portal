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
      className={`zoom-panel w-full rounded-2xl bg-page ${className}`}
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
  origin,
}: {
  onClose: () => void;
  children: React.ReactNode;
  /** Drawers with their own action rail supply the close button themselves. */
  hideClose?: boolean;
  /**
   * Viewport point the drawer should grow OUT of — the centre of the card that
   * was clicked. Turns the open into a zoom from that tile instead of a dialog
   * landing on top of it. Omit and it scales from the middle, as before.
   */
  origin?: { x: number; y: number } | null;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      // Slightly darker and blurrier than before, so the drawer reads as the
      // only live thing on screen.
      className="zoom-backdrop fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-[3px]"
      onClick={onClose}
      // The origin is expressed as a percentage of the viewport and inherited
      // by every .zoom-panel inside, so both boxes of a split drawer grow from
      // the same point.
      // typeof window guard: client components still run through the server
      // render, and touching window there is a crash, not a warning.
      style={
        origin && typeof window !== "undefined"
          ? ({
              "--zoom-x": `${(origin.x / window.innerWidth) * 100}%`,
              "--zoom-y": `${(origin.y / window.innerHeight) * 100}%`,
            } as React.CSSProperties)
          : undefined
      }
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
