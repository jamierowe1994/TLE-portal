"use client";

import DoodleIcon from "@/components/DoodleIcon";

// The overview bar that sits under a grid page's title: a handful of headline
// figures in one outlined box, split by hairlines. Icon on the left of each,
// figure and label stacked beside it.

export interface StatStripItem {
  /** Doodle icon name (public/icons/doodle). */
  icon: string;
  value: string;
  label: string;
  /** A small coloured dot after the label — for "and some need attention". */
  dot?: "amber" | "red" | "green" | "blue";
  /** Tint the icon (compliance rate reads better in green). */
  tone?: "ink" | "green" | "red";
}

const DOT: Record<string, string> = {
  amber: "bg-amber-500",
  red: "bg-red-500",
  green: "bg-emerald-500",
  blue: "bg-sky-500",
};

const TONE: Record<string, string> = {
  ink: "text-ink",
  green: "text-emerald-600",
  red: "text-accent",
};

export default function StatStrip({ items }: { items: StatStripItem[] }) {
  return (
    <div className="card grid grid-cols-2 gap-y-5 p-5 sm:grid-cols-3 lg:flex lg:gap-y-0">
      {items.map((s, i) => (
        <div
          key={s.label}
          className={`flex min-w-0 flex-1 items-start gap-3 lg:px-5 ${
            i > 0 ? "lg:border-l lg:border-line" : "lg:pl-0"
          } ${i === items.length - 1 ? "lg:pr-0" : ""}`}
        >
          {/* halfway between block-centred and figure-top — sits on the numeral */}
          <DoodleIcon
            name={s.icon}
            size={24}
            className={`mt-[6px] shrink-0 ${TONE[s.tone ?? "ink"]}`}
          />
          <div className="min-w-0">
            <div className="stat-value text-[21px] leading-none" style={{ fontWeight: 400 }}>
              {s.value}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted">
              <span className="truncate">{s.label}</span>
              {s.dot ? (
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[s.dot]}`} />
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
