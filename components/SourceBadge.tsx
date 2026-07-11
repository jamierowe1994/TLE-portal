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

export default function SourceBadge({
  source,
  note,
  asOf,
}: {
  source: StatSource;
  note?: string;
  asOf?: string;
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
      : undefined);

  return (
    <span
      className={`source-badge inline-flex items-center whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide ${style.className}`}
      title={tooltip}
    >
      {label}
    </span>
  );
}
