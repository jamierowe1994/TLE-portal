import React from "react";

interface GaugeProps {
  /** 0–100 (may exceed 100 — the arc caps at full but the label shows true %). */
  pct: number | null;
  label: string;
  sub?: string;
  color?: string;
  size?: number;
}

/**
 * Circular progress ring with the percentage in the centre. Reads instantly —
 * used for the agent's conversion rates. Null → an empty ring with an em dash.
 */
export default function Gauge({
  pct,
  label,
  sub,
  color = "#E31F36",
  size = 104,
}: GaugeProps) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const capped = pct == null ? 0 : Math.max(0, Math.min(pct, 100));
  const dash = (capped / 100) * c;

  return (
    <div className="flex flex-col items-center text-center">
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(16, 16, 20, 0.28)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: "stroke-dasharray 0.6s cubic-bezier(0.22,1,0.36,1)" }}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span className="tnum text-[19px] font-semibold leading-none">
            {pct == null ? "—" : `${Math.round(pct)}%`}
          </span>
        </div>
      </div>
      <div className="mt-2 text-[12px] font-medium text-ink">{label}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}
