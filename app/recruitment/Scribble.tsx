"use client";

// A mark from the Scribbles pack (public/illustrations/scribbles/s-<n>.svg),
// coloured via CSS mask so it takes currentColor like the doodle icons do —
// the raw SVGs are hard-coded near-black (#231f20), which would never quite
// match the ink token and could never be tinted.
//
// Replaces the hand-authored paths that were here before: a licensed pack
// drawn by an illustrator beats bezier curves guessed in code.
//
// The pack's numbering does NOT match its preview sheet's grid order — every
// number below was verified by rasterising the actual file. Add new ones by
// looking, not by counting.

const PACK: Record<string, number> = {
  sparkles: 7, // four-point diamond sparkles
  confetti: 11, // scattered curls and dots
  dashes: 22, // three diagonal emphasis dashes
  spiral: 26, // loose spiral
  swoosh: 30, // s-curve swoosh
  underline: 33, // double wavy underline
  wind: 39, // three curled gusts
  bang: 50, // exclamation mark
  arrow: 62, // curved arrow, pointing up-right
  pop: 64, // two short arrows bursting upward — the corner marks
  quotes: 27, // two hand-drawn quote curls — rotate 180 for the opener
  smile: 107, // little smiley
  house: 143, // scribbled house
};

export default function Scribble({
  name,
  className = "",
}: {
  name: keyof typeof PACK;
  className?: string;
}) {
  const n = PACK[name];
  if (!n) return null;
  const url = `url(/illustrations/scribbles/s-${n}.svg)`;
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute ${className}`}
      style={{
        backgroundColor: "currentColor",
        maskImage: url,
        WebkitMaskImage: url,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}
