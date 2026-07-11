import React from "react";
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
}

export function Bars({ labels, series, format = defaultFormat, height = 220 }: BarsProps) {
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
    <div>
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
            <g key={li}>
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
