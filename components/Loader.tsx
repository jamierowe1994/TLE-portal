// The portal's loading mark: two little ink shapes chasing each other around a
// square orbit, morphing square → pill as they corner (styles: .duo-loader in
// globals.css). Drop it anywhere something is loading.

export default function Loader({
  label,
  className = "",
}: {
  /** Optional line under the mark, e.g. "Loading your properties…" */
  label?: string;
  className?: string;
}) {
  return (
    // min-h centres the mark in the content viewport (below the top line,
    // right of the rail) rather than hugging the page header.
    // The 0.45s-delayed fade means quick loads never show a loader at all —
    // it only appears once a wait is genuinely a wait.
    <div
      className={`flex min-h-[calc(100vh-340px)] flex-col items-center justify-center gap-5 text-ink [animation:enter-fade_0.35s_ease_0.45s_both] ${className}`}
      role="status"
      aria-live="polite"
    >
      <span className="duo-loader" aria-hidden />
      <span className="text-[13px] text-muted">{label ?? "Loading…"}</span>
    </div>
  );
}
