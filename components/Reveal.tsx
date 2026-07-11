"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePresent } from "@/components/PresentMode";

interface RevealProps {
  children: React.ReactNode;
  delay?: number; // ms
  className?: string;
}

/**
 * Light fade/rise-in on scroll into view. Respects prefers-reduced-motion
 * and becomes a no-op while presentation mode is active.
 */
export function Reveal({ children, delay = 0, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { presenting } = usePresent();
  const [shown, setShown] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    if (reduced || presenting || typeof IntersectionObserver === "undefined") {
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
      { threshold: 0.08, rootMargin: "0px 0px -24px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, reduced, presenting]);

  const animate = !reduced && !presenting;

  return (
    <div
      ref={ref}
      className={className}
      style={
        animate
          ? {
              opacity: shown ? 1 : 0,
              transform: shown ? "none" : "translateY(12px)",
              transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms`,
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

export default Reveal;
