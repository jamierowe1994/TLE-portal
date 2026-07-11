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

interface LineProps {
  labels: string[];
  series: ChartSeries[];
  format?: (n: number) => string;
  height?: number;
}

export function Line({ labels, series, format = defaultFormat, height = 220 }: LineProps) {
  const width = 640;
  const pad = { top: 12, right: 12, bottom: 26, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const ticks = niceTicks(maxOfSeries(series));
  const yMax = ticks[ticks.length - 1] || 1;
  const n = Math.max(labels.length, 1);
  const x = (i: number) => (n === 1 ? pad.left + plotW / 2 : pad.left + (i / (n - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - (v / yMax) * plotH;

  // Build path segments per series, breaking at nulls (gaps).
  const pathFor = (values: (number | null)[]): string => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  const labelStep = Math.ceil(n / 12);

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={`Line chart: ${series.map((s) => s.name).join(", ")}`}
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
        {labels.map((label, i) =>
          i % labelStep === 0 ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={10.5} fill={CHART_MUTED}>
              {label}
            </text>
          ) : null
        )}
        {series.map((s, si) => (
          <g key={s.name}>
            <path d={pathFor(s.values)} fill="none" stroke={seriesColor(s, si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) =>
              v == null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={3} fill="#FFFFFF" stroke={seriesColor(s, si)} strokeWidth={1.75}>
                  <title>{`${labels[i]} — ${s.name}: ${format(v)}`}</title>
                </circle>
              )
            )}
          </g>
        ))}
      </svg>
      {series.length > 1 && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6 }}>
          {series.map((s, i) => (
            <span key={s.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: CHART_MUTED }}>
              <span style={{ width: 9, height: 3, borderRadius: 2, background: seriesColor(s, i), display: "inline-block" }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default Line;
