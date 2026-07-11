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
}: {
  label: string;
  stat: StatValue;
  sub?: string;
  big?: boolean;
}) {
  const display =
    stat.display ?? (stat.value == null ? "—" : formatNum(stat.value));

  return (
    <div className="card relative p-5">
      <div className="absolute right-4 top-4">
        <SourceBadge source={stat.source} note={stat.note} asOf={stat.asOf} />
      </div>
      <div className="stat-label pr-16 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className={`stat-value mt-2 ${big ? "stat-value--big" : ""}`}>
        {display}
      </div>
      {sub ? <div className="mt-1.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}
