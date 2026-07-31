// Shown wherever a figure is still being gathered — PayProp and REX walks are
// fast now but never instant, and a bare "—" reads as "nothing here" rather
// than "not yet". Three dots bob in sequence: first up and down, then the
// second, then the third.

export default function FindingData({
  label = "Finding data",
  className = "",
}: {
  /** Override when something more specific is being fetched. */
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-baseline gap-[3px] text-muted ${className}`}
      role="status"
      aria-live="polite"
    >
      <span>{label}</span>
      <span aria-hidden className="inline-flex items-baseline gap-[2px]">
        <i className="bob-dot" />
        <i className="bob-dot" />
        <i className="bob-dot" />
      </span>
    </span>
  );
}
