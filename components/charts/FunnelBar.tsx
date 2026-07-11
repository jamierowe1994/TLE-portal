import React from "react";
import { CHART_COLORS, CHART_INK, CHART_MUTED, defaultFormat } from "@/components/charts/scale";

interface FunnelBarProps {
  stages: { label: string; value: number }[];
}

/**
 * Horizontal funnel: one bar per stage scaled to the max value, with the
 * step-conversion % shown between consecutive stages.
 */
export function FunnelBar({ stages }: FunnelBarProps) {
  const width = 640;
  const barH = 30;
  const stepH = 18; // conversion row between bars
  const labelW = 130;
  const valueW = 64;
  const plotW = width - labelW - valueW;
  const max = Math.max(...stages.map((s) => s.value), 1);
  const height = stages.length * barH + Math.max(stages.length - 1, 0) * stepH + 4;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={`Funnel: ${stages.map((s) => `${s.label} ${s.value}`).join(", ")}`}
      style={{ display: "block" }}
    >
      {stages.map((stage, i) => {
        const top = i * (barH + stepH) + 2;
        const w = Math.max((stage.value / max) * plotW, stage.value > 0 ? 3 : 0);
        const prev = i > 0 ? stages[i - 1].value : null;
        const conv = prev != null && prev > 0 ? (stage.value / prev) * 100 : null;
        return (
          <g key={stage.label}>
            <text x={labelW - 10} y={top + barH / 2 + 4} textAnchor="end" fontSize={12} fill={CHART_INK}>
              {stage.label}
            </text>
            <rect x={labelW} y={top} width={plotW} height={barH} rx={6} fill="#F6F6F8" />
            <rect x={labelW} y={top} width={w} height={barH} rx={6} fill={CHART_COLORS[0]} opacity={0.92}>
              <title>{`${stage.label}: ${defaultFormat(stage.value)}`}</title>
            </rect>
            <text
              x={labelW + plotW + 8}
              y={top + barH / 2 + 4}
              fontSize={12.5}
              fontWeight={600}
              fill={CHART_INK}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {defaultFormat(stage.value)}
            </text>
            {conv != null && (
              <text x={labelW + 4} y={top + barH + stepH - 5} fontSize={10.5} fill={CHART_MUTED}>
                {`↓ ${conv.toFixed(0)}%`}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default FunnelBar;
