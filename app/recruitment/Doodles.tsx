"use client";

// Hand-drawn marks for the recruitment page: the biro squiggles and the circled
// word. Drawn as SVG rather than shipped as images so they take currentColor
// and can be animated — the circle draws itself in, which is the one bit of
// motion the hero earns.

/** The lasso around a word in the headline. */
export function Circled({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-block whitespace-nowrap">
      <span className="relative z-10">{children}</span>
      <svg
        viewBox="0 0 240 90"
        preserveAspectRatio="none"
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[145%] w-[118%] -translate-x-1/2 -translate-y-1/2 overflow-visible text-ink"
      >
        {/* Two passes, deliberately not concentric — one clean loop reads as a
            vector oval, two slightly-off loops read as a pen. */}
        <path
          className="doodle-draw"
          d="M141 8 C 62 2, 8 20, 9 46 C 10 74, 88 86, 152 82 C 214 78, 236 60, 231 40 C 227 22, 190 8, 132 7"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <path
          className="doodle-draw doodle-draw-2"
          d="M136 13 C 66 9, 16 26, 18 47 C 21 70, 92 80, 150 76"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.5}
        />
      </svg>
    </span>
  );
}

/** Loose biro scribbles for the margins. Six shapes, picked by name. */
const MARKS: Record<string, { d: string; box: string }> = {
  swirl: {
    box: "0 0 120 120",
    d: "M12 96 C 40 96, 60 78, 58 58 C 56 40, 34 34, 28 48 C 22 63, 42 76, 66 70 C 96 63, 108 34, 96 16",
  },
  arrow: {
    box: "0 0 120 80",
    d: "M6 58 C 34 22, 68 12, 110 20 M110 20 L 92 12 M110 20 L 96 34",
  },
  sparks: {
    box: "0 0 100 100",
    d: "M20 50 L 44 50 M32 38 L 32 62 M66 22 L 82 22 M74 14 L 74 30 M58 74 L 72 74 M65 67 L 65 81",
  },
  underline: {
    box: "0 0 200 24",
    d: "M6 14 C 56 4, 128 4, 194 12 M14 20 C 62 12, 130 12, 186 18",
  },
  grass: {
    box: "0 0 100 80",
    d: "M14 74 C 20 46, 30 30, 42 18 M40 74 C 44 52, 52 38, 64 26 M64 74 C 66 54, 74 42, 86 32",
  },
  loop: {
    box: "0 0 140 90",
    d: "M8 60 C 26 18, 62 10, 78 34 C 90 52, 66 70, 54 56 C 44 44, 62 26, 86 30 C 112 34, 128 52, 132 74",
  },
};

export function Mark({
  name,
  className = "",
  width = 2.5,
}: {
  name: keyof typeof MARKS | string;
  className?: string;
  width?: number;
}) {
  const m = MARKS[name];
  if (!m) return null;
  return (
    <svg
      viewBox={m.box}
      aria-hidden
      className={`pointer-events-none absolute overflow-visible text-ink/25 ${className}`}
      fill="none"
    >
      <path d={m.d} stroke="currentColor" strokeWidth={width} strokeLinecap="round" />
    </svg>
  );
}
