"use client";

import { useEffect, useRef, useState } from "react";

// Scroll-reveal, scoped to the recruitment page.
//
// The portal already has a Reveal, but it reads PresentMode context that only
// exists inside the dashboard tree — using it here would throw. This is the
// same idea with no dependencies.
//
// Reveals ONCE and then stops observing. Content that fades every time it
// re-enters the viewport is a nuisance on a long marketing page you scroll back
// up through.

export default function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  /** ms — stagger siblings so a row arrives as a wave, not a block. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Anyone who has asked for less motion gets the content immediately, in
    // place — never a hidden element waiting on an observer that won't fire.
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      typeof IntersectionObserver === "undefined"
    ) {
      setShown(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      // Fires slightly before the element is fully on screen, so the motion has
      // finished by the time it is in comfortable reading position.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(18px)",
        transition: `opacity 620ms cubic-bezier(0.22,1,0.36,1) ${delay}ms, transform 620ms cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
        willChange: shown ? "auto" : "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}
