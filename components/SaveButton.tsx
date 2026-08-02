"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The save button that collapses, spins and ticks.
 *
 * Sequence: idle → (click) the label slides out and the button squeezes to a
 * circle → a ring spins while the work runs → the ring becomes a tick → it
 * holds a beat → it widens back out to the label.
 *
 * The point is that "saved" is felt rather than read. Two rules keep it honest:
 *
 *  · The tick only ever follows a genuine success. onSave returns false (or
 *    throws) and the button goes straight back to its label — the caller's own
 *    error message does the talking, and a tick on a failed save is a lie the
 *    animation must never tell.
 *  · A very fast save still shows the spinner briefly (MIN_SPIN). Without it a
 *    100ms round trip is a flicker that reads as a glitch, not a save.
 */

const MIN_SPIN_MS = 420;
const TICK_HOLD_MS = 900;
const SQUEEZE_MS = 180;

type Phase = "idle" | "spin" | "tick";

export default function SaveButton({
  onSave,
  label = "Save changes",
  savingLabel,
  disabled = false,
  variant = "accent",
  className = "",
  type = "button",
}: {
  /** Do the work. Resolve true for saved, false for "it didn't" — false
   *  suppresses the tick. Throwing is treated as false. */
  onSave: () => Promise<boolean | void>;
  label?: string;
  /** Screen-reader text while spinning (the visual label is hidden). */
  savingLabel?: string;
  disabled?: boolean;
  /** "accent" = filled red; "quiet" = outlined, for secondary saves. */
  variant?: "accent" | "quiet";
  className?: string;
  type?: "button" | "submit";
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  // Every timer is tracked so unmounting mid-sequence can't setState on a dead
  // component — this button lives on a page people navigate away from.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
  }, []);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(() => alive.current && fn(), ms));
  };

  async function run() {
    if (phase !== "idle" || disabled) return;
    setPhase("spin");
    const startedAt = Date.now();
    let ok = false;
    try {
      ok = (await onSave()) !== false;
    } catch {
      ok = false;
    }
    if (!alive.current) return;
    const rest = Math.max(0, MIN_SPIN_MS - (Date.now() - startedAt));
    later(() => {
      if (!ok) {
        // Straight back to the label. No tick, no pause — the caller is
        // already showing why it failed.
        setPhase("idle");
        return;
      }
      setPhase("tick");
      later(() => setPhase("idle"), TICK_HOLD_MS);
    }, rest);
  }

  const busy = phase !== "idle";
  const base =
    variant === "accent"
      ? "accent-bg text-white"
      : "border border-line text-ink hover:border-black/30";

  return (
    <button
      type={type}
      onClick={run}
      // Disabled while animating so a second click can't start an overlapping
      // sequence — and aria-live announces the outcome for anyone not
      // watching the shape change.
      disabled={disabled || busy}
      aria-live="polite"
      aria-label={busy ? (savingLabel ?? "Saving") : label}
      className={`btn-press relative flex h-9 items-center justify-center overflow-hidden rounded-lg text-[13px] font-semibold transition-[width,background-color,opacity] disabled:opacity-60 ${base} ${
        busy ? "w-9 px-0" : "w-[var(--save-w,auto)] px-4"
      } ${className}`}
      style={{ transitionDuration: `${SQUEEZE_MS}ms` }}
    >
      {/* The label slides out to the left as the button squeezes shut, and
          back in when it reopens. Kept mounted so the width transition has
          something to measure against. */}
      <span
        className={`whitespace-nowrap transition-all duration-150 ${
          busy ? "-translate-x-2 opacity-0" : "translate-x-0 opacity-100"
        }`}
      >
        {label}
      </span>

      {busy ? (
        <span className="absolute inset-0 flex items-center justify-center">
          {phase === "spin" ? (
            <span
              className={`h-4 w-4 animate-spin rounded-full border-2 border-t-transparent ${
                variant === "accent" ? "border-white/80" : "border-ink/60"
              }`}
            />
          ) : (
            <svg
              viewBox="0 0 24 24"
              className={`tick-in h-4 w-4 ${variant === "accent" ? "text-white" : "text-emerald-600"}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          )}
        </span>
      ) : null}
    </button>
  );
}
