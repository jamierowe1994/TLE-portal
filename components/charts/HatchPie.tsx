import React from "react";

// A clean, honest pie — but instead of solid fills, each slice is white with
// diagonal hatch lines in its colour, like it's been shaded in by hand. Ink
// outlines keep it in the doodle family without the wobble.

interface HatchPieProps {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  centerLabel?: string;
  centerSub?: string;
}

function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  a0: number,
  a1: number
): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r: number, a: number) =>
    `${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  return [
    `M ${p(rOuter, a0)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${p(rOuter, a1)}`,
    `L ${p(rInner, a1)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${p(rInner, a0)}`,
    "Z",
  ].join(" ");
}

// Alternating hatch angles so neighbouring slices read differently even where
// the reds sit close together.
const HATCH_ANGLES = [45, -45, 20, -70, 60, -20];

export default function HatchPie({
  segments,
  size = 170,
  centerLabel,
  centerSub,
}: HatchPieProps) {
  const total = segments.reduce((t, s) => t + Math.max(s.value, 0), 0);
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 6;
  const hole = R * 0.52;

  let angle = -Math.PI / 2; // start at 12 o'clock
  const slices = segments
    .filter((s) => s.value > 0)
    .map((s, i) => {
      const frac = total > 0 ? s.value / total : 0;
      const a0 = angle;
      // Full-circle single slice needs a hair under 2π or the arc collapses.
      const a1 = angle + Math.min(frac, 0.9999) * Math.PI * 2;
      angle = a1;
      return { seg: s, frac, d: arcPath(cx, cy, R, hole, a0, a1), i };
    });

  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      style={{ maxWidth: "100%", flexShrink: 0 }}
      role="img"
      aria-label={`Pie: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}
    >
      <defs>
        {slices.map(({ seg, i }) => (
          <pattern
            key={i}
            id={`hatch-${uid}-${i}`}
            patternUnits="userSpaceOnUse"
            width={6}
            height={6}
            patternTransform={`rotate(${HATCH_ANGLES[i % HATCH_ANGLES.length]})`}
          >
            <line x1={0} y1={0} x2={0} y2={6} stroke={seg.color} strokeWidth={2.4} />
          </pattern>
        ))}
      </defs>

      {slices.map(({ seg, frac, d, i }) => (
        <path
          key={seg.label}
          d={d}
          fill={`url(#hatch-${uid}-${i})`}
          stroke="#101014"
          strokeWidth={1.5}
          strokeLinejoin="round"
        >
          <title>{`${seg.label}: ${seg.value}${total > 0 ? ` (${Math.round(frac * 100)}%)` : ""}`}</title>
        </path>
      ))}

      {centerLabel ? (
        <text
          x={cx}
          y={centerSub ? cy : cy + 5}
          textAnchor="middle"
          fontSize={17}
          fontWeight={600}
          fill="#101014"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {centerLabel}
        </text>
      ) : null}
      {centerSub ? (
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize={9.5} fill="#6b6b70">
          {centerSub}
        </text>
      ) : null}
    </svg>
  );
}
