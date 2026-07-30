"use client";

import { useState } from "react";
import DoodleIcon from "@/components/DoodleIcon";

// The property drawer's progress indicator — a landscape chain of skewed
// segments (the YNAB rule-progress idea, tipped on its side). Completed
// segments fill in deepening shades of brand red as the chain advances;
// unfinished ones stay as outlines wearing a small dot per outstanding task.
// Tapping a segment bounces it and pops its word up underneath.

export interface SkewStep {
  label: string;
  /** 0..1 — 1 is done; anything between part-fills the segment. */
  progress: number;
  note?: string;
  /** Doodle icon name (public/icons/doodle). */
  icon?: string;
  /** Outstanding tasks behind this step — one dot each. Defaults to 1 while unfinished. */
  count?: number;
}

const ACCENT = [227, 31, 54] as const;

export default function SkewProgress({ steps }: { steps: SkewStep[] }) {
  const firstOpen = steps.findIndex((s) => s.progress < 1);
  const [sel, setSel] = useState(firstOpen === -1 ? steps.length - 1 : firstOpen);
  // Retrigger the bounce even when re-clicking the same segment.
  const [pulse, setPulse] = useState(0);

  const n = steps.length;
  // Deeper red the further along the chain the segment sits.
  const shade = (i: number, a = 1) =>
    `rgba(${ACCENT[0]}, ${ACCENT[1]}, ${ACCENT[2]}, ${((0.3 + (n <= 1 ? 0.7 : (0.7 * i) / (n - 1))) * a).toFixed(2)})`;

  const current = steps[sel];

  return (
    <div>
      <div className="flex items-stretch gap-2 pl-2">
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
              className={`skew-seg relative h-[46px] flex-1 rounded-[6px] border-[1.5px] ${
                seld ? "skew-seg--sel border-ink" : done ? "border-ink/70" : "border-ink/35 hover:border-ink/60"
              }`}
              style={{
                background: done
                  ? shade(i)
                  : part
                    ? `linear-gradient(to right, ${shade(i)} ${Math.round(s.progress * 100)}%, transparent ${Math.round(s.progress * 100)}%)`
                    : "transparent",
              }}
              // Re-key nothing: pulse only forces the animation class to re-apply.
              data-pulse={seld ? pulse : undefined}
            >
              {/* content sits unskewed inside the parallelogram */}
              <span
                className="flex h-full w-full items-center justify-center"
                style={{ transform: "skewX(14deg)" }}
              >
                {s.icon ? (
                  <DoodleIcon
                    name={s.icon}
                    size={18}
                    // White only once the red is deep enough to carry it.
                    className={done ? (i / Math.max(1, n - 1) >= 0.5 ? "text-white" : "text-ink/50") : "text-muted"}
                  />
                ) : null}
                {/* one dot per outstanding task, perched top-right */}
                {dots > 0 ? (
                  <span className="absolute right-1.5 top-1.5 flex gap-1">
                    {Array.from({ length: Math.min(dots, 3) }).map((_, d) => (
                      <span key={d} className="h-1.5 w-1.5 rounded-full bg-ink/70" />
                    ))}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {/* the word for wherever they've clicked — pops in with a bounce */}
      {current ? (
        <p key={`${sel}-${pulse}`} className="skew-caption mt-2.5 flex items-center gap-2 text-[12px]">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: shade(sel) }} />
          <span className="font-semibold text-ink">{current.label}</span>
          {current.note ? <span className="text-muted">— {current.note}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
