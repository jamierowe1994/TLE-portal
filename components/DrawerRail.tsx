"use client";

import DoodleIcon from "@/components/DoodleIcon";

// The drawer's action rail: one long pill down the right-hand edge of a record
// drawer, holding every action that record supports. Hand-drawn icons, no
// backgrounds, tooltips on hover. Close always sits at the top.
//
// The press is deliberately physical: each button carries a tight backdrop
// blur that snaps off as it's pushed in, so it reads as a real key going down
// into the surface rather than a flat colour change.

export interface RailAction {
  id: string;
  /** Doodle icon name (public/icons/doodle). */
  icon: string;
  label: string;
  onClick: () => void;
  /** Rendered pressed-in while its panel is the active one. */
  active?: boolean;
  /** Sits apart at the top (the close button). */
  top?: boolean;
}

function RailButton({ a }: { a: RailAction }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        a.onClick();
      }}
      aria-label={a.label}
      className={`rail-key group/rail relative flex h-10 w-10 items-center justify-center rounded-full transition ${
        a.active ? "rail-key--on text-ink" : "text-muted hover:text-ink"
      }`}
    >
      <DoodleIcon name={a.icon} size={19} />
      {/* tooltip — sits to the left so it never leaves the viewport */}
      <span className="pointer-events-none absolute right-[calc(100%+10px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/rail:opacity-100">
        {a.label}
      </span>
    </button>
  );
}

export default function DrawerRail({ actions }: { actions: RailAction[] }) {
  const top = actions.filter((a) => a.top);
  const rest = actions.filter((a) => !a.top);

  return (
    <div
      className="absolute left-full top-1/2 z-30 ml-5 flex -translate-y-1/2 flex-col items-center gap-1 rounded-full border border-line bg-card/95 p-1.5 shadow-lg backdrop-blur-sm max-lg:hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* the little line tying the rail back to the drawer */}
      <span aria-hidden className="absolute right-full top-1/2 h-px w-5 bg-black/20" />
      {top.map((a) => (
        <RailButton key={a.id} a={a} />
      ))}
      {top.length && rest.length ? <span className="my-0.5 h-px w-5 bg-line" /> : null}
      {rest.map((a) => (
        <RailButton key={a.id} a={a} />
      ))}
    </div>
  );
}
