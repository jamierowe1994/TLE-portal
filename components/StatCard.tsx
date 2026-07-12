import type { StatValue } from "@/lib/types";
import { formatNum } from "@/lib/format";
import SourceBadge from "@/components/SourceBadge";

// White stat card: small uppercase label, big tabular-nums figure, optional
// sub-note, SourceBadge top-right. `big` bumps the figure size (hero stats).
// Presentation mode scales .stat-value up via globals.css.

export default function StatCard({
  label,
  stat,
  sub,
  big = false,
  size = "default",
}: {
  label: string;
  stat: StatValue;
  sub?: string;
  big?: boolean;
  size?: "default" | "sm";
}) {
  const display =
    stat.display ?? (stat.value == null ? "—" : formatNum(stat.value));

  const sizeClass = big ? "stat-value--big" : size === "sm" ? "stat-value--sm" : "";

  return (
    <div className={`card relative ${size === "sm" ? "p-4" : "p-5"}`}>
      <div className="absolute right-3.5 top-3.5">
        <SourceBadge source={stat.source} note={stat.note} asOf={stat.asOf} />
      </div>
      <div className="stat-label pr-14 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className={`stat-value mt-2 ${sizeClass}`}>{display}</div>
      {sub ? <div className="mt-1.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}
