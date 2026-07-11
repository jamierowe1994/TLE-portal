import React from "react";
import { CHART_COLORS, CHART_INK, CHART_MUTED, defaultFormat } from "@/components/charts/scale";

interface DonutProps {
  segments: { label: string; value: number; color?: string }[];
  centerLabel?: string;
}

/** Donut chart via stroke-dasharray on circles, with centre label + legend. */
export function Donut({ segments, centerLabel }: DonutProps) {
  const size = 180;
  const r = 66;
  const strokeW = 22;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((sum, s) => sum + Math.max(s.value, 0), 0);

  let offset = 0;
  const arcs = segments.map((s, i) => {
    const frac = total > 0 ? Math.max(s.value, 0) / total : 0;
    const arc = { seg: s, i, frac, dashOffset: -offset * c };
    offset += frac;
    return arc;
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        style={{ maxWidth: "100%", flexShrink: 0 }}
        role="img"
        aria-label={`Donut: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F6F6F8" strokeWidth={strokeW} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {arcs.map(({ seg, i, frac, dashOffset }) =>
            frac <= 0 ? null : (
              <circle
                key={seg.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={seg.color ?? CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={strokeW}
                strokeDasharray={`${(frac * c).toFixed(2)} ${c.toFixed(2)}`}
                strokeDashoffset={dashOffset.toFixed(2)}
              >
                <title>{`${seg.label}: ${defaultFormat(seg.value)}${total > 0 ? ` (${((frac) * 100).toFixed(0)}%)` : ""}`}</title>
              </circle>
            )
          )}
        </g>
        {centerLabel && (
          <text
            x={size / 2}
            y={size / 2 + 5}
            textAnchor="middle"
            fontSize={15}
            fontWeight={600}
            fill={CHART_INK}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {centerLabel}
          </text>
        )}
      </svg>
      <div style={{ display: "grid", gap: 6 }}>
        {segments.map((s, i) => (
          <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: CHART_MUTED }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 3,
                background: s.color ?? CHART_COLORS[i % CHART_COLORS.length],
                display: "inline-block",
              }}
            />
            <span style={{ color: CHART_INK }}>{s.label}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{defaultFormat(s.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default Donut;
