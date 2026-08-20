// Where a figure came from, next to the thing itself.
//
// StatCard already carries a SourceBadge, so every boxed number can be traced.
// Nothing else could: section headings, table totals and the tables themselves
// had no way of saying where their rows came from, and Susan kept having to
// ask. This is the same idea in a form that sits inline next to a heading.
//
// Deliberately an ⓘ rather than a coloured dot: a dot beside a heading reads
// as a status light for the section, and these are not statuses — they are
// provenance. `tone` still distinguishes a live source from a stale one,
// because "where is this from" and "can I trust it today" are one question.
export default function SourceNote({
  children,
  tone = "live",
}: {
  /** The provenance itself. Say the SYSTEM and the QUERY, not just "PayProp" —
   *  "PayProp report/tenant/balances, negative balances only" answers the
   *  question; "PayProp" invites the follow-up. */
  children: string;
  tone?: "live" | "snapshot" | "derived";
}) {
  const colour =
    tone === "live"
      ? "text-green-600/70 hover:text-green-700"
      : tone === "derived"
        ? "text-slate-500/70 hover:text-slate-600"
        : "text-amber-600/70 hover:text-amber-700";
  const prefix =
    tone === "live" ? "Live · " : tone === "derived" ? "Worked out here · " : "Snapshot · ";
  return (
    <span
      className={`source-badge ml-1.5 cursor-help align-middle text-[12px] leading-none ${colour}`}
      title={`${prefix}${children}`}
      aria-label={`Source: ${prefix}${children}`}
      role="note"
    >
      ⓘ
    </span>
  );
}
