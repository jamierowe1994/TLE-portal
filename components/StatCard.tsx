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

  // Every card carries the same corner dot — green for live, amber for not.
  // The mix of text pills and dots made it impossible to scan a tab and tell
  // at a glance which figures were real; the wording is in the tooltip.
  const compactBadge = true;

  return (
    <div className={`card card-lift relative h-full ${size === "sm" ? "p-4" : "p-5"}`}>
      <div className={compactBadge ? "absolute right-3 top-3.5" : "absolute right-4 top-4"}>
        <SourceBadge source={stat.source} note={stat.note} asOf={stat.asOf} compact={compactBadge} />
      </div>
      <div className={`stat-label text-[11px] font-semibold uppercase tracking-wide text-muted ${compactBadge ? "pr-4" : "pr-16"}`}>
        {label}
      </div>
      <div className={`stat-value mt-2 ${sizeClass}`}>{display}</div>
      {sub ? <div className="mt-1.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}
