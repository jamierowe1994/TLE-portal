"use client";

import React, { useEffect, useRef, useState } from "react";
import { CHART_GRID, CHART_MUTED, niceTicks } from "@/components/charts/scale";

interface ForecastChartProps {
  labels: string[]; // month short labels
  actuals: (number | null)[]; // solid line — what's already known (past)
  forecast: (number | null)[]; // the forecast series; points from `editableFrom` are draggable
  editableFrom: number; // first index whose forecast handle can be dragged
  onChange?: (index: number, value: number) => void; // live, during drag
  onCommit?: (index: number, value: number) => void; // on release
  format?: (n: number) => string;
  height?: number;
  accent?: string;
}

const VB_W = 680;

/**
 * Interactive multi-month forecast line. Solid = actuals (past), dashed =
 * forecast with a draggable handle on every editable future month, so the
 * agent builds their forward forecast month by month.
 */
export default function ForecastChart({
  labels,
  actuals,
  forecast,
  editableFrom,
  onChange,
  onCommit,
  format = (n) => `£${Math.round(n / 1000)}k`,
  height = 260,
  accent = "#e31f36",
}: ForecastChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const pad = { top: 20, right: 22, bottom: 30, left: 54 };
  const plotW = VB_W - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const allVals = [...actuals, ...forecast].filter((v): v is number => v != null);
  const maxVal = allVals.length ? Math.max(...allVals) : 1000;
  const ticks = niceTicks(Math.max(maxVal * 1.15, 1));
  const yMax = ticks[ticks.length - 1] || 1;

  const n = Math.max(labels.length, 1);
  const x = (i: number) => (n === 1 ? pad.left + plotW / 2 : pad.left + (i / (n - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - (Math.max(0, Math.min(v, yMax)) / yMax) * plotH;

  const lastActualIndex = (() => {
    for (let i = actuals.length - 1; i >= 0; i--) if (actuals[i] != null) return i;
    return -1;
  })();

  function valueFromClientY(clientY: number): number {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const scale = height / rect.height;
    const svgY = (clientY - rect.top) * scale;
    const v = (yMax * (pad.top + plotH - svgY)) / plotH;
    return Math.max(0, Math.min(v, yMax));
  }

  useEffect(() => {
    if (dragIndex == null) return;
    const move = (e: PointerEvent) => onChange?.(dragIndex, valueFromClientY(e.clientY));
    const up = (e: PointerEvent) => {
      onCommit?.(dragIndex, valueFromClientY(e.clientY));
      setDragIndex(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragIndex, yMax]);

  // Solid actuals path.
  let actualLine = "";
  let pen = false;
  actuals.forEach((v, i) => {
    if (v == null) {
      pen = false;
      return;
    }
    actualLine += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
  });

  // Dashed forecast path — connect from the last actual through the forecast points.
  const fcPoints: Array<{ i: number; v: number }> = [];
  if (lastActualIndex >= 0 && actuals[lastActualIndex] != null) {
    fcPoints.push({ i: lastActualIndex, v: actuals[lastActualIndex] as number });
  }
  forecast.forEach((v, i) => {
    if (v != null && i > lastActualIndex) fcPoints.push({ i, v });
  });
  const fcLine = fcPoints.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VB_W} ${height}`}
      width="100%"
      role="img"
      aria-label="Forecast builder"
      style={{ display: "block", touchAction: "none", userSelect: "none" }}
    >
      <defs>
        {/* Same language as the hatched pie — earned months read as shaded-in. */}
        <pattern id="fc-hatch" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={6} stroke={accent} strokeWidth={1.6} opacity={0.5} />
        </pattern>
      </defs>

      {/* gridlines + y labels */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.left} x2={VB_W - pad.right} y1={y(t)} y2={y(t)} stroke={CHART_GRID} strokeWidth={1} strokeDasharray="2 4" />
          <text x={pad.left - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill={CHART_MUTED}>
            {format(t)}
          </text>
        </g>
      ))}

      {/* month labels; editable months emphasised */}
      {labels.map((label, i) => (
        <text
          key={i}
          x={x(i)}
          y={height - 9}
          textAnchor="middle"
          fontSize={10.5}
          fontWeight={i >= editableFrom ? 700 : 400}
          fill={i >= editableFrom ? accent : CHART_MUTED}
        >
          {label}
        </text>
      ))}

      {/* actuals — line plus a hatched area beneath, like the pie's shading */}
      {(() => {
        const pts = actuals
          .map((v, i) => (v == null ? null : { i, v }))
          .filter((p): p is { i: number; v: number } => p != null);
        if (pts.length < 2) return null;
        const top = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
        const base = `L${x(pts[pts.length - 1].i).toFixed(1)},${(pad.top + plotH).toFixed(1)} L${x(pts[0].i).toFixed(1)},${(pad.top + plotH).toFixed(1)} Z`;
        return <path d={`${top} ${base}`} fill="url(#fc-hatch)" stroke="none" />;
      })()}
      <path d={actualLine.trim()} fill="none" stroke={accent} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
      {actuals.map((v, i) =>
        v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={3} fill="#fff" stroke={accent} strokeWidth={1.75} />
      )}

      {/* forecast dashed line */}
      <path d={fcLine} fill="none" stroke={accent} strokeWidth={2} strokeDasharray="5 5" opacity={0.85} />

      {/* draggable handles */}
      {forecast.map((v, i) => {
        if (v == null || i < editableFrom) return null;
        const active = dragIndex === i;
        return (
          <g
            key={`h-${i}`}
            style={{ cursor: "ns-resize" }}
            onPointerDown={(e) => {
              e.preventDefault();
              setDragIndex(i);
              onChange?.(i, valueFromClientY(e.clientY));
            }}
          >
            <circle cx={x(i)} cy={y(v)} r={16} fill="transparent" />
            <circle cx={x(i)} cy={y(v)} r={active ? 8 : 6} fill={accent} stroke="#fff" strokeWidth={2.5} />
            {active ? (
              <g transform={`translate(${Math.min(Math.max(x(i), pad.left + 34), VB_W - pad.right - 34)}, ${Math.max(y(v) - 30, 12)})`}>
                <rect x={-34} y={-15} width={68} height={22} rx={6} fill={accent} />
                <text x={0} y={0} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff">
                  {format(v)}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
