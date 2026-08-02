// Phones are blocked, deliberately: the portal's boards and tables are built
// for desktop and tablet, and a squashed board that half-works reads worse
// than an honest "not yet". CSS-only (visible below Tailwind's md, 768px) so
// there is no resize listener and no hydration concern — an iPad in portrait
// is 768px exactly and stays allowed. A phone held landscape can slip past
// the width check; that is accepted rather than sniffing user agents.
export default function MobileGate() {
  return (
    <div
      className="fixed inset-0 z-[999] flex flex-col items-center justify-center gap-4 bg-page px-8 text-center md:hidden"
      role="dialog"
      aria-label="Desktop only"
    >
      <h1 className="written text-[34px] leading-none text-ink">TLE OS</h1>
      <p className="max-w-[26rem] text-[14px] leading-relaxed text-muted">
        Sorry — TLE OS is desktop and tablet only for now. We&apos;re working
        on v2 for mobile.
      </p>
      <p className="text-[12px] text-muted/70">
        Sign in from a desktop or tablet to carry on.
      </p>
    </div>
  );
}
