"use client";

// Where a property is up to, drawn rather than plotted: each milestone is a
// wobbly hand-inked bar that fills with diagonal hatching when it's done.
// Same language as the hatched pie, so the whole portal reads as one sketch.

export interface Milestone {
  label: string;
  /** 0–1. Anything above 0 draws a partial fill. */
  progress: number;
  /** Short note under the label, e.g. "Expires 12 Mar 2027". */
  note?: string;
}

// Deterministic wobble so a given bar always draws the same way (and SSR and
// the client agree).
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hand-drawn rounded rectangle path, edges gently uneven. */
function inkBar(w: number, h: number, seed: number): string {
  const rand = rng(seed);
  const j = () => (rand() - 0.5) * 1.5; // ±0.75px wobble
  const r = h / 2;
  return [
    `M ${r + j()} ${0 + j()}`,
    `L ${w - r + j()} ${0 + j()}`,
    `A ${r} ${r} 0 0 1 ${w - r + j()} ${h + j()}`,
    `L ${r + j()} ${h + j()}`,
    `A ${r} ${r} 0 0 1 ${r + j()} ${0 + j()}`,
    "Z",
  ].join(" ");
}

export default function MilestoneBars({
  milestones,
  accent = "#e31f36",
}: {
  milestones: Milestone[];
  accent?: string;
}) {
  const W = 300;
  const H = 13;

  return (
    <div className="space-y-3">
      {milestones.map((m, i) => {
        const pct = Math.max(0, Math.min(1, m.progress));
        const done = pct >= 1;
        return (
          <div key={m.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className={`text-[12px] ${done ? "text-ink" : "text-muted"}`}>
                {m.label}
              </span>
              {m.note ? (
                <span className="shrink-0 text-[10.5px] text-muted/80">{m.note}</span>
              ) : null}
            </div>
            <svg
              viewBox={`0 0 ${W} ${H + 2}`}
              className="mt-1 w-full"
              preserveAspectRatio="none"
              role="img"
              aria-label={`${m.label}: ${Math.round(pct * 100)}%`}
            >
              <defs>
                <pattern
                  id={`bar-hatch-${i}`}
                  patternUnits="userSpaceOnUse"
                  width={5}
                  height={5}
                  patternTransform="rotate(45)"
                >
                  <line x1={0} y1={0} x2={0} y2={5} stroke={accent} strokeWidth={2.4} />
                </pattern>
                <clipPath id={`bar-clip-${i}`}>
                  <path d={inkBar(W, H, i * 31 + 7)} transform="translate(0,1)" />
                </clipPath>
              </defs>

              {/* the filled portion, hatched, clipped to the wobbly bar */}
              <g clipPath={`url(#bar-clip-${i})`}>
                <rect
                  className="bar-fill"
                  style={{ ["--delay" as string]: `${i * 90}ms` }}
                  x={0}
                  y={1}
                  width={W * pct}
                  height={H}
                  fill={`url(#bar-hatch-${i})`}
                />
              </g>

              {/* the ink outline over the top */}
              <path
                d={inkBar(W, H, i * 31 + 7)}
                transform="translate(0,1)"
                fill="none"
                stroke="#101014"
                strokeWidth={1.4}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
