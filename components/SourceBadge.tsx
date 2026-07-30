import type { StatSource } from "@/lib/types";
import { formatDateShort } from "@/lib/format";

// Small badge tagging where a figure came from. Every stat in the UI carries
// one so live / manual / snapshot figures can be worked through one by one.
// Hidden in presentation mode via `body.presenting .source-badge` (globals.css).

const STYLES: Record<
  StatSource,
  { label: string; className: string }
> = {
  "live-rex": {
    label: "LIVE",
    className: "bg-green-50 text-green-700 border-green-200",
  },
  "live-meta": {
    label: "LIVE",
    className: "bg-green-50 text-green-700 border-green-200",
  },
  "live-propoly": {
    label: "LIVE",
    className: "bg-green-50 text-green-700 border-green-200",
  },
  "live-teg": {
    label: "LIVE",
    className: "bg-green-50 text-green-700 border-green-200",
  },
  "live-payprop": {
    label: "LIVE",
    className: "bg-green-50 text-green-700 border-green-200",
  },
  "live-ghl": {
    label: "LIVE",
    className: "bg-green-50 text-green-700 border-green-200",
  },
  manual: {
    label: "MANUAL",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  snapshot: {
    label: "SNAPSHOT",
    className: "bg-gray-100 text-gray-500 border-gray-200",
  },
  derived: {
    label: "DERIVED",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

const DOT: Record<StatSource, string> = {
  "live-rex": "#22c55e",
  "live-meta": "#22c55e",
  "live-propoly": "#22c55e",
  "live-teg": "#22c55e",
  "live-ghl": "#22c55e",
  "live-payprop": "#22c55e",
  manual: "#f59e0b",
  snapshot: "#9ca3af",
  derived: "#94a3b8",
};

export default function SourceBadge({
  source,
  note,
  asOf,
  compact = false,
}: {
  source: StatSource;
  note?: string;
  asOf?: string;
  /** Render just a colour dot (full detail in the tooltip) — for dense cards. */
  compact?: boolean;
}) {
  const style = STYLES[source] ?? STYLES.snapshot;
  let label = style.label;
  if (source === "snapshot" && asOf) {
    const short = formatDateShort(asOf);
    if (short) label = `SNAPSHOT · ${short}`;
  }
  const tooltip =
    note ??
    (source === "snapshot"
      ? "Couldn't match a live stat for this yet — figure from the TLE Business Dashboard snapshot."
      : label);

  if (compact) {
    return (
      <span
        className="source-badge inline-block h-2 w-2 rounded-full"
        style={{ background: DOT[source] ?? DOT.snapshot }}
        title={asOf && source === "snapshot" ? `${label} — ${tooltip}` : `${label}${note ? ` — ${note}` : ""}`}
        aria-label={label}
      />
    );
  }

  return (
    <span
      className={`source-badge inline-flex items-center whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide ${style.className}`}
      title={tooltip}
    >
      {label}
    </span>
  );
}
