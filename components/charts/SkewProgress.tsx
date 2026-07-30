"use client";

import { useState } from "react";
import DoodleIcon from "@/components/DoodleIcon";

// The property drawer's progress indicator: a row of soft circles, one per
// step, sat straight on the eggshell — no hard outlines, just a slightly
// deeper beige and a tight shadow to lift them off the page. Done steps fill
// in deepening shades of brand red along the chain; unfinished ones wear a
// small dot per outstanding task. A blob sits behind the selected circle and
// bobbles over metaball-style when you click the next one, squashing as it
// travels; the step's word pops up underneath.

export interface SkewStep {
  label: string;
  /** 0..1 — 1 is done; anything between part-fills the circle. */
  progress: number;
  note?: string;
  /** Doodle icon name (public/icons/doodle). */
  icon?: string;
  /** Outstanding tasks behind this step — one dot each. Defaults to 1 while unfinished. */
  count?: number;
}

const ACCENT = [227, 31, 54] as const;
const SIZE = 46; // circle diameter
const GAP = 14; // gap between circles

export default function SkewProgress({ steps }: { steps: SkewStep[] }) {
  const firstOpen = steps.findIndex((s) => s.progress < 1);
  const [sel, setSel] = useState(firstOpen === -1 ? steps.length - 1 : firstOpen);
  const [pulse, setPulse] = useState(0);

  const n = steps.length;
  // Deeper red the further along the chain the step sits.
  const shade = (i: number, a = 1) =>
    `rgba(${ACCENT[0]}, ${ACCENT[1]}, ${ACCENT[2]}, ${((0.3 + (n <= 1 ? 0.7 : (0.7 * i) / (n - 1))) * a).toFixed(2)})`;

  const current = steps[sel];

  return (
    <div>
      <div className="relative w-fit" style={{ height: SIZE }}>
        {/* the metaball — a blob that bobbles across to whichever circle is
            picked. The outer span travels (left transition), the keyed inner
            span squashes afresh on every hop. */}
        <span
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2"
          style={{
            width: SIZE + 8,
            height: SIZE + 8,
            left: sel * (SIZE + GAP) - 4,
            transition: `left 0.55s cubic-bezier(0.3, 1.5, 0.5, 1)`,
          }}
        >
          <span
            key={pulse}
            className="blob block h-full w-full rounded-full"
            style={{ background: "rgba(16, 16, 20, 0.07)" }}
          />
        </span>
        <div className="relative flex items-center" style={{ gap: GAP }}>
          {steps.map((s, i) => {
            const done = s.progress >= 1;
            const part = !done && s.progress > 0;
            const dots = done ? 0 : Math.max(1, s.count ?? 1);
            const seld = i === sel;
            return (
              <button
                key={s.label}
                type="button"
                onClick={() => {
                  setSel(i);
                  setPulse((p) => p + 1);
                }}
                aria-label={`${s.label} — ${s.note ?? (done ? "done" : "outstanding")}`}
                className={`relative flex shrink-0 items-center justify-center rounded-full transition-transform duration-200 hover:-translate-y-0.5 hover:scale-105 active:scale-95 ${
                  seld ? "blob-pop" : ""
                }`}
                style={{
                  width: SIZE,
                  height: SIZE,
                  // A slightly deeper beige than the page, lifted by a tight shadow.
                  background: done
                    ? shade(i)
                    : part
                      ? `linear-gradient(to top, ${shade(i)} ${Math.round(s.progress * 100)}%, #e9e6dd ${Math.round(s.progress * 100)}%)`
                      : "#e9e6dd",
                  boxShadow: "0 1px 2px rgba(16,16,20,0.18), 0 2px 5px rgba(16,16,20,0.08)",
                }}
              >
                {s.icon ? (
                  <DoodleIcon
                    name={s.icon}
                    size={19}
                    // White only once the red is deep enough to carry it.
                    className={done ? (i / Math.max(1, n - 1) >= 0.5 ? "text-white" : "text-ink/60") : "text-ink/55"}
                  />
                ) : null}
                {/* one dot per outstanding task, perched on the rim */}
                {dots > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex gap-0.5">
                    {Array.from({ length: Math.min(dots, 3) }).map((_, d) => (
                      <span key={d} className="h-2 w-2 rounded-full border border-page bg-ink/75" />
                    ))}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* the word for wherever they've clicked — pops in with a bounce */}
      {current ? (
        <p key={`${sel}-${pulse}`} className="skew-caption mt-3 flex items-center gap-2 text-[12px]">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: shade(sel) }} />
          <span className="font-semibold text-ink">{current.label}</span>
          {current.note ? <span className="text-muted">— {current.note}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
