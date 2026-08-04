"use client";

// The street scene at the top of My Properties, with its birds flying.
//
// houses.png is a raster, so nothing inside it can be animated. The three birds
// were therefore lifted OUT of the artwork into houses-still.png (a script
// cleared those pixels to transparent — the sky is alpha, not a colour, so
// there was nothing to patch), and are redrawn here as SVG on top, at the exact
// coordinates they occupied.
//
// Positions are percentages of the original 811x474 artwork, so they stay
// pinned to the sky at every width the header uses.
//
// A fourth candidate blob at (561,207) was NOT a bird — it is a chimney on the
// third house. Worth knowing before anyone "fixes" the missing one.

interface Bird {
  /** % of artwork width/height, from the source PNG's own pixel boxes. */
  left: number;
  top: number;
  width: number;
  /** Seconds per wingbeat, and where in the cycle this bird starts. */
  beat: number;
  delay: number;
}

const BIRDS: Bird[] = [
  // (264,82)-(317,96) — the big one, left of centre
  { left: 32.55, top: 17.3, width: 6.66, beat: 1.5, delay: 0 },
  // (360,54)-(398,68) — higher, middle
  { left: 44.39, top: 11.39, width: 4.81, beat: 1.15, delay: -0.45 },
  // (622,136)-(639,144) — small, far right, reads as distant
  { left: 76.7, top: 28.69, width: 2.22, beat: 1.85, delay: -0.9 },
];

/**
 * One gull. Two wings rotating about the shoulder — the flap is a rotation, not
 * a path morph, because animating `d` isn't reliable across browsers.
 *
 * Each bird gets its own beat and a negative delay so it starts mid-cycle:
 * three birds flapping in unison reads as a machine rather than as birds.
 */
function Gull({ b, i }: { b: Bird; i: number }) {
  return (
    <span
      className="houses-bird pointer-events-none absolute"
      style={{
        left: `${b.left}%`,
        top: `${b.top}%`,
        width: `${b.width}%`,
        ["--beat" as string]: `${b.beat}s`,
        ["--delay" as string]: `${b.delay}s`,
        ["--drift" as string]: `${(i % 2 ? -1 : 1) * 1.5}px`,
      }}
    >
      <svg viewBox="0 0 40 20" fill="none" className="h-auto w-full overflow-visible">
        <g
          stroke="#2b2b2b"
          strokeWidth={3}
          strokeLinecap="round"
        >
          <path className="wing wing-l" d="M20 12 C 14 5, 8 3, 2 4" />
          <path className="wing wing-r" d="M20 12 C 26 5, 32 3, 38 4" />
        </g>
      </svg>
    </span>
  );
}

export default function HousesScene({
  className = "",
  // The recruitment page runs the mono plate: its hero is monochrome-plus-clay
  // and the red house would be the one thing on the canvas breaking the rule.
  src = "/illustrations/houses-still.png",
}: {
  className?: string;
  src?: string;
}) {
  return (
    <div className={`pointer-events-none relative shrink-0 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" aria-hidden className="block w-full" />
      {BIRDS.map((b, i) => (
        <Gull key={i} b={b} i={i} />
      ))}

    </div>
  );
}
