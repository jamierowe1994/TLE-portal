// Hand-drawn doodle icons (licensed set, /public/icons/doodle). The SVGs are
// solid black fills, so they're rendered through a CSS mask — the icon takes
// `currentColor`, which means active/muted states are just text colour, same
// as any stroke icon. Add more by dropping SVGs into the folder and passing
// their filename as `name`.

export default function DoodleIcon({
  name,
  size = 18,
  className = "",
}: {
  /** Filename in /public/icons/doodle. Omit the extension for the SVG set;
   * pass it in full (e.g. "bed.png") for the PNG masks. */
  name: string;
  size?: number;
  className?: string;
}) {
  const url = `url(/icons/doodle/${name.includes(".") ? name : `${name}.svg`})`;
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: "currentColor",
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
