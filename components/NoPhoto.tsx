// The no-photo state, everywhere a property photo would sit: the Notioly
// "lost the way" chap inside the same rounded frame — hairline outline,
// see-through middle — so a missing photo never reads as a blank hole.

export default function NoPhoto({
  label,
  className = "",
  fit = "zoom",
}: {
  /** Optional caption under the figure (the drawers say "No photos yet"). */
  label?: string;
  className?: string;
  /**
   * "zoom" (tiles): the figure fills the frame large and crops at the edges —
   * losing his legs beats not being able to see him at all.
   * "contain" (drawer banner): whole figure, caption underneath.
   */
  fit?: "zoom" | "contain";
}) {
  if (fit === "contain") {
    return (
      <div
        className={`flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl border border-line bg-transparent ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/illustrations/notioly/adventurous-cat.svg"
          alt=""
          aria-hidden
          className="max-h-[72%] max-w-[72%] object-contain"
        />
        {label ? <span className="text-[11px] text-muted">{label}</span> : null}
      </div>
    );
  }
  return (
    // Absolutely positioned so the percentage sizing resolves against the
    // frame's real height (in-flow % heights collapse to the SVG's intrinsic
    // 520px here and balloon the tile).
    <div
      className={`relative h-full w-full overflow-hidden rounded-xl border border-line bg-transparent ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/illustrations/notioly/adventurous-cat.svg"
        alt=""
        aria-hidden
        className="absolute left-1/2 top-1/2 h-[125%] w-auto max-w-none -translate-x-1/2 -translate-y-1/2"
      />
    </div>
  );
}
