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
  // A filled circle marks wherever you are; the close key keeps its own.
  const shape = a.top
    ? `rail-key rounded-full ${a.active ? "rail-key--on" : ""}`
    : `rounded-full transition active:scale-[0.88] ${a.active ? "bg-black/[0.07]" : ""}`;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        a.onClick();
      }}
      aria-label={a.label}
      className={`group/rail relative flex h-11 w-11 items-center justify-center ${shape} ${
        a.active ? "text-ink" : "text-muted hover:text-ink"
      }`}
    >
      <DoodleIcon name={a.icon} size={22} />
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
    // Inside the drawer now, hard against its right edge: a squared-off pill
    // in the same paper colour, outlined rather than floated.
    <div
      className="absolute right-4 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-1 rounded-[26px] border border-ink/25 bg-page p-1.5 max-lg:hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {top.map((a) => (
        <RailButton key={a.id} a={a} />
      ))}
      {top.length && rest.length ? <span className="my-1 h-px w-5 bg-ink/15" /> : null}
      {rest.map((a) => (
        <RailButton key={a.id} a={a} />
      ))}
    </div>
  );
}
