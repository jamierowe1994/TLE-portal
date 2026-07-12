import React from "react";

interface SparklineProps {
  values: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
  /** Fill the area under the line with a soft gradient. */
  fill?: boolean;
  strokeWidth?: number;
}

/**
 * Tiny axis-less trend line for hero cards. Nulls break the line into gaps.
 * Scales to its own min/max with a little headroom so the shape reads clearly.
 */
export default function Sparkline({
  values,
  width = 168,
  height = 46,
  color = "#E31F36",
  fill = true,
  strokeWidth = 2,
}: SparklineProps) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) {
    return <div style={{ width, height }} aria-hidden="true" />;
  }

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const pad = 3;
  const n = values.length;

  const x = (i: number) => pad + (i / (n - 1)) * (width - pad * 2);
  const y = (v: number) =>
    height - pad - ((v - min) / range) * (height - pad * 2);

  // Line path (breaks at nulls) + area path (only spans contiguous points).
  let line = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v == null) {
      pen = false;
      return;
    }
    line += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
  });

  const firstIdx = values.findIndex((v) => v != null);
  const lastIdx = values.length - 1 - [...values].reverse().findIndex((v) => v != null);
  const area =
    fill && firstIdx >= 0
      ? `${line}L${x(lastIdx).toFixed(1)},${(height - pad).toFixed(1)} L${x(
          firstIdx
        ).toFixed(1)},${(height - pad).toFixed(1)} Z`
      : "";

  const gid = `spark-${color.replace("#", "")}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label="Trend"
      style={{ display: "block", maxWidth: "100%" }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {area ? <path d={area} fill={`url(#${gid})`} stroke="none" /> : null}
      <path
        d={line.trim()}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Last point marker */}
      {lastIdx >= 0 && values[lastIdx] != null ? (
        <circle cx={x(lastIdx)} cy={y(values[lastIdx] as number)} r={2.6} fill={color} />
      ) : null}
    </svg>
  );
}
