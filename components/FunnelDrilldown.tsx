"use client";

import DoodleIcon from "@/components/DoodleIcon";

/**
 * The panel that opens underneath a funnel figure on My Dashboard — the
 * records behind the number. Chrome only: the caller supplies the rows.
 *
 * It lives inside a CollapsePanel, so it must never unmount while the panel is
 * still shrinking — the close button just flips the caller's state and lets the
 * panel see its own movement through.
 */
export default function FunnelDrilldown({
  title,
  icon,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  /** Doodle icon name (public/icons/doodle). */
  icon: string;
  /** One quiet line saying what this list actually is. */
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
            <DoodleIcon name={icon} size={15} className="text-accent" />
            {title}
          </h3>
          {subtitle ? <p className="mt-1 text-[12px] text-muted">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full bg-page px-2.5 py-1 text-[11px] font-medium text-muted transition hover:text-ink"
        >
          Close
        </button>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/**
 * What we show when the COUNT is real but the ROWS aren't joined to a source
 * yet. Deliberately empty-handed and says which system owes us the records —
 * a placeholder list of invented properties would be worse than no list.
 */
export function DrilldownPending({
  count,
  needs,
}: {
  /** The figure on the tile, so the message lines up with what they clicked. */
  count: number | null;
  /** Which system will supply the rows, e.g. "REX Listings". */
  needs: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-5">
      <p className="text-[13px] text-ink">
        {count == null || count === 0
          ? "No records to open out yet."
          : `The ${count} above ${count === 1 ? "is" : "are"} a live count — the individual records aren't wired into the portal yet.`}
      </p>
      <p className="mt-1.5 text-[12px] text-muted">
        Next step: pull them through from <span className="font-medium text-ink">{needs}</span>.
      </p>
    </div>
  );
}
