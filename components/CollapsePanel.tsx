"use client";

/**
 * A panel that grows and shrinks by its real height. `grid-template-rows`
 * 1fr → 0fr animates proportionally from the first frame (max-height can't),
 * so neighbours are genuinely pushed along rather than jumping. Nothing
 * unmounts mid-flight, so the movement is always seen through to the end.
 *
 * Pair it with `PANEL_STAGGER` on whichever panel is opening: the outgoing
 * ones shrink first, then the incoming one opens into the space they left.
 */

/** How long a panel takes to open or close. Deliberately unhurried. */
export const PANEL_MS = 1120;
/** The pause that lets the outgoing panels finish before the new one opens. */
export const PANEL_STAGGER = 600;

export default function CollapsePanel({
  open,
  delay = 0,
  grow = false,
  children,
}: {
  open: boolean;
  /** Hold off so the outgoing panels finish shrinking first. */
  delay?: number;
  /** Take the leftover column height while it's open. */
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      // collapse-panel: the hook globals.css uses to cut the transition dead
      // for anyone on prefers-reduced-motion (it has to out-rank the inline
      // style below, so the rule is !important).
      className={`collapse-panel grid ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"} ${
        open && grow ? "min-h-0 flex-1" : ""
      }`}
      style={{
        transition:
          `grid-template-rows ${PANEL_MS}ms cubic-bezier(0.32, 0.72, 0, 1) ${delay}ms,` +
          ` opacity ${Math.round(PANEL_MS * 0.7)}ms ease ${delay}ms`,
      }}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">
        <div className={`${open && grow ? "h-full" : ""} pb-5`}>{children}</div>
      </div>
    </div>
  );
}
