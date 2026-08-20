"use client";

import React, { useState } from "react";
import {
  CHART_GRID,
  CHART_MUTED,
  type ChartSeries,
  defaultFormat,
  maxOfSeries,
  niceTicks,
  seriesColor,
} from "@/components/charts/scale";

interface BarsProps {
  labels: string[];
  series: ChartSeries[];
  format?: (n: number) => string;
  height?: number;
  /** What each bar is MADE OF, one entry per label. A total on its own invites
   *  "made up of what?", and until now the only way to answer was to go and
   *  ask. Rendered on hover; omit it and the chart behaves as it always did. */
  details?: Array<Array<[string, string]>>;
}

export function Bars({
  labels,
  series,
  format = defaultFormat,
  height = 220,
  details,
}: BarsProps) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const pad = { top: 12, right: 12, bottom: 26, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const ticks = niceTicks(maxOfSeries(series));
  const yMax = ticks[ticks.length - 1] || 1;
  const y = (v: number) => pad.top + plotH - (v / yMax) * plotH;

  const groupW = plotW / Math.max(labels.length, 1);
  const gap = groupW * 0.25;
  const barW = Math.max((groupW - gap) / Math.max(series.length, 1), 2);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={`Bar chart: ${series.map((s) => s.name).join(", ")}`}
        style={{ display: "block" }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={CHART_GRID} strokeWidth={1} />
            <text x={pad.left - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={CHART_MUTED}>
              {format(t)}
            </text>
          </g>
        ))}
        {labels.map((label, li) => {
          const gx = pad.left + li * groupW + gap / 2;
          return (
            <g
              key={li}
              onMouseEnter={() => setHover(li)}
              onMouseLeave={() => setHover(null)}
            >
              {/* Full-height catcher: aiming at a short bar is fiddly, and a
                  January that earned little is exactly the month someone wants
                  to interrogate. */}
              <rect
                x={pad.left + li * groupW}
                y={pad.top}
                width={groupW}
                height={plotH}
                fill={hover === li ? "currentColor" : "transparent"}
                opacity={hover === li ? 0.04 : 0}
              />
              {series.map((s, si) => {
                const v = s.values[li];
                if (v == null) return null;
                const by = y(Math.max(v, 0));
                const bh = Math.max(pad.top + plotH - by, v > 0 ? 1.5 : 0);
                return (
                  <rect
                    key={si}
                    x={gx + si * barW}
                    y={by}
                    width={Math.max(barW - 2, 1.5)}
                    height={bh}
                    rx={2}
                    fill={seriesColor(s, si)}
                  >
                    <title>{`${label} — ${s.name}: ${format(v)}`}</title>
                  </rect>
                );
              })}
              <text
                x={gx + (groupW - gap) / 2}
                y={height - 8}
                textAnchor="middle"
                fontSize={10.5}
                fill={CHART_MUTED}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      {details && hover != null && details[hover]?.length ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-50 w-[15rem] rounded-lg bg-ink px-3 py-2 text-[11.5px] leading-relaxed text-white shadow-lg"
          style={{
            left: `${((hover + 0.5) / Math.max(labels.length, 1)) * 100}%`,
            top: 8,
            transform:
              hover > labels.length / 2 ? "translateX(-105%)" : "translateX(5%)",
          }}
        >
          <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-wider text-white/60">
            {labels[hover]}
          </div>
          {details[hover].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <span className="text-white/70">{k}</span>
              <span className="tnum">{v}</span>
            </div>
          ))}
        </div>
      ) : null}
      {series.length > 1 && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6 }}>
          {series.map((s, i) => (
            <span key={s.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: CHART_MUTED }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: seriesColor(s, i), display: "inline-block" }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default Bars;
