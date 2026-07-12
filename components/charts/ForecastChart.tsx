"use client";

import React, { useEffect, useRef, useState } from "react";
import { CHART_GRID, CHART_MUTED, niceTicks } from "@/components/charts/scale";

interface ForecastChartProps {
  labels: string[]; // month short labels, one per index
  actuals: (number | null)[]; // net income per month (null = no actual yet)
  targetIndex: number; // index of the month being forecast
  target: number | null; // live target value (owned by the parent)
  onChange?: (v: number) => void; // fires continuously while dragging
  onCommit?: (v: number) => void; // fires on release
  format?: (n: number) => string;
  height?: number;
  /** [startIdx, endIdx] month indices to highlight with a faint accent band. */
  highlightRange?: [number, number] | null;
}

const ACCENT = "#e31f36";
const VB_W = 680;

/**
 * Actual-vs-forecast line the agent can play with: solid red area for months
 * with real earnings, a dashed projection to a draggable target on the
 * forecast month. Dragging the handle (or typing a figure elsewhere that
 * updates `target`) animates the line in real time.
 */
export default function ForecastChart({
  labels,
  actuals,
  targetIndex,
  target,
  onChange,
  onCommit,
  format = (n) => `£${Math.round(n / 1000)}k`,
  height = 250,
  highlightRange = null,
}: ForecastChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  // The value actually drawn — eases toward `target` for playful motion.
  const startTarget = target ?? actuals.filter((v): v is number => v != null).slice(-1)[0] ?? 0;
  const [disp, setDisp] = useState(startTarget);
  const dispRef = useRef(disp);
  const setDispBoth = (v: number) => {
    dispRef.current = v;
    setDisp(v);
  };

  const pad = { top: 18, right: 20, bottom: 30, left: 54 };
  const plotW = VB_W - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxActual = Math.max(0, ...actuals.filter((v): v is number => v != null));
  const basis = Math.max(maxActual, target ?? 0, 4000) * 1.5;
  const ticks = niceTicks(basis);
  const yMax = ticks[ticks.length - 1] || 1;

  const n = Math.max(labels.length, 1);
  const x = (i: number) => (n === 1 ? pad.left + plotW / 2 : pad.left + (i / (n - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - (Math.max(0, Math.min(v, yMax)) / yMax) * plotH;

  const lastActualIndex = (() => {
    for (let i = actuals.length - 1; i >= 0; i--) if (actuals[i] != null) return i;
    return -1;
  })();

  // Animate disp → target whenever the parent's target changes (e.g. typing),
  // unless the user is mid-drag (then the handle tracks the pointer directly).
  useEffect(() => {
    if (draggingRef.current) {
      setDispBoth(target ?? dispRef.current);
      return;
    }
    const from = dispRef.current;
    const to = target ?? startTarget;
    if (Math.abs(from - to) < 1) {
      setDispBoth(to);
      return;
    }
    // Snap (no animation) when motion can't or shouldn't run: reduced-motion
    // users, or a hidden tab where requestAnimationFrame is throttled/paused.
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || (typeof document !== "undefined" && document.hidden)) {
      setDispBoth(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const dur = 460;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      setDispBoth(from + (to - from) * ease(t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  function valueFromClientY(clientY: number): number {
    const svg = svgRef.current;
    if (!svg) return dispRef.current;
    const rect = svg.getBoundingClientRect();
    const scale = height / rect.height; // viewBox units per CSS px
    const svgY = (clientY - rect.top) * scale;
    const v = (yMax * (pad.top + plotH - svgY)) / plotH;
    const clamped = Math.max(0, Math.min(v, yMax));
    return Math.round(clamped / 100) * 100; // snap to nearest £100
  }

  // Drag lifecycle via window listeners (robust across the whole viewport).
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const v = valueFromClientY(e.clientY);
      setDispBoth(v);
      onChange?.(v);
    };
    const up = (e: PointerEvent) => {
      const v = valueFromClientY(e.clientY);
      draggingRef.current = false;
      setDragging(false);
      onCommit?.(v);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, yMax]);

  // Actual line + area (contiguous real points).
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
  const firstIdx = actuals.findIndex((v) => v != null);
  const actualArea =
    firstIdx >= 0 && lastActualIndex >= 0
      ? `${actualLine}L${x(lastActualIndex).toFixed(1)},${y(0).toFixed(1)} L${x(firstIdx).toFixed(1)},${y(0).toFixed(1)} Z`
      : "";

  const handleX = x(targetIndex);
  const handleY = y(disp);
  // Anchor the dashed projection at the month before the target (Jun → Jul),
  // falling back to the last real point or the handle itself.
  const anchorIndex = Math.max(0, targetIndex - 1);
  const anchorVal =
    actuals[anchorIndex] ??
    (lastActualIndex >= 0 ? (actuals[lastActualIndex] as number) : disp);
  const anchorX = x(anchorIndex);
  const anchorY = y(anchorVal);

  const labelStep = Math.ceil(n / 12);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VB_W} ${height}`}
      width="100%"
      role="img"
      aria-label="Actual earnings versus forecast"
      style={{ display: "block", touchAction: "none", userSelect: "none" }}
    >
      <defs>
        <linearGradient id="fc-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity={0.2} />
          <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* selected-period highlight band */}
      {highlightRange
        ? (() => {
            const half = n > 1 ? plotW / (n - 1) / 2 : plotW / 2;
            const [a, b] = highlightRange;
            const bandX = Math.max(pad.left, x(Math.min(a, b)) - half);
            const bandR = Math.min(VB_W - pad.right, x(Math.max(a, b)) + half);
            return (
              <rect
                x={bandX}
                y={pad.top}
                width={Math.max(0, bandR - bandX)}
                height={plotH}
                fill={ACCENT}
                opacity={0.055}
                rx={6}
              />
            );
          })()
        : null}

      {/* gridlines + y labels */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.left} x2={VB_W - pad.right} y1={y(t)} y2={y(t)} stroke={CHART_GRID} strokeWidth={1} />
          <text x={pad.left - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill={CHART_MUTED}>
            {format(t)}
          </text>
        </g>
      ))}

      {/* month labels + forecast-month emphasis */}
      {labels.map((label, i) =>
        i % labelStep === 0 || i === targetIndex ? (
          <text
            key={i}
            x={x(i)}
            y={height - 9}
            textAnchor="middle"
            fontSize={10.5}
            fontWeight={i === targetIndex ? 700 : 400}
            fill={i === targetIndex ? ACCENT : CHART_MUTED}
          >
            {label}
          </text>
        ) : null
      )}

      {/* actual area + line */}
      {actualArea ? <path d={actualArea} fill="url(#fc-area)" stroke="none" /> : null}
      <path d={actualLine.trim()} fill="none" stroke={ACCENT} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
      {actuals.map((v, i) =>
        v == null ? null : (
          <circle key={i} cx={x(i)} cy={y(v)} r={3} fill="#fff" stroke={ACCENT} strokeWidth={1.75} />
        )
      )}

      {/* forecast projection (dashed) from last actual → target handle */}
      <line
        x1={anchorX}
        y1={anchorY}
        x2={handleX}
        y2={handleY}
        stroke={ACCENT}
        strokeWidth={2}
        strokeDasharray="5 5"
        opacity={target == null ? 0.4 : 0.85}
      />

      {/* draggable target handle */}
      <g
        style={{ cursor: "ns-resize" }}
        onPointerDown={(e) => {
          e.preventDefault();
          draggingRef.current = true;
          setDragging(true);
          const v = valueFromClientY(e.clientY);
          setDispBoth(v);
          onChange?.(v);
        }}
      >
        {/* generous invisible hit area */}
        <circle cx={handleX} cy={handleY} r={18} fill="transparent" />
        <circle
          cx={handleX}
          cy={handleY}
          r={dragging ? 8 : 6}
          fill={ACCENT}
          stroke="#fff"
          strokeWidth={2.5}
          style={{ transition: dragging ? "none" : "r 0.15s ease" }}
        />
        {/* value bubble */}
        <g transform={`translate(${Math.min(handleX, VB_W - pad.right - 40)}, ${Math.max(handleY - 30, 10)})`}>
          <rect x={-34} y={-15} width={68} height={22} rx={6} fill={ACCENT} />
          <text x={0} y={0} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff">
            {format(disp)}
          </text>
        </g>
      </g>
    </svg>
  );
}
