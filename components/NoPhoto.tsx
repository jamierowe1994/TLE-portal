// The no-photo state, everywhere a property photo would sit: the Notioly
// "lost the way" chap inside the same rounded frame — hairline outline,
// see-through middle — so a missing photo never reads as a blank hole.

export default function NoPhoto({
  label,
  className = "",
}: {
  /** Optional caption under the figure (the drawers say "No photos yet"). */
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl border border-line bg-transparent ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/illustrations/notioly/lost-the-way.svg"
        alt=""
        aria-hidden
        className="max-h-[72%] max-w-[72%] object-contain"
      />
      {label ? <span className="text-[11px] text-muted">{label}</span> : null}
    </div>
  );
}
