// The no-photo state, everywhere a property photo would sit: a Notioly figure
// inside the same rounded frame — hairline outline, see-through middle — so a
// missing photo never reads as a blank hole.

/**
 * "Embracing the Universe" (Notioly 260). One constant rather than two literals,
 * because this has now been swapped twice and the header comment fell out of
 * date both times.
 *
 * The sizing below is deliberately unchanged from the illustration it replaced,
 * despite this one's ink box being narrower (364x397 against 425x419 in the same
 * 520 canvas). Matching the box would have overfilled the frame: the moon is a
 * solid mass where the previous figure was line art, so it carries far more
 * visual weight per unit of area. Checked at tile, drawer-thumb and banner sizes.
 */
const FIGURE = "/illustrations/notioly/embracing-the-universe.svg";

export default function NoPhoto({
  label,
  className = "",
  fit = "zoom",
}: {
  /** Optional caption under the figure (the drawers say "No photos yet"). */
  label?: string;
  className?: string;
  /**
   * "zoom" (tiles): the figure sits large in the frame. At 100% the whole
   * illustration fits — the moon needs its own breathing room in a card, where
   * the previous line-art figure could be cropped without losing anything.
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
          src={FIGURE}
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
        src={FIGURE}
        alt=""
        aria-hidden
        className="absolute left-1/2 top-1/2 h-[100%] w-auto max-w-none -translate-x-1/2 -translate-y-1/2"
      />
    </div>
  );
}
