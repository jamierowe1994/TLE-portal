"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

interface PresentContextValue {
  presenting: boolean;
  toggle: () => void;
}

const PresentContext = createContext<PresentContextValue>({
  presenting: false,
  toggle: () => {},
});

export function usePresent(): PresentContextValue {
  return useContext(PresentContext);
}

export function PresentProvider({ children }: { children: React.ReactNode }) {
  const [presenting, setPresenting] = useState(false);

  // Keep <body class="presenting"> in sync with state.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("presenting", presenting);
    return () => {
      document.body.classList.remove("presenting");
    };
  }, [presenting]);

  // Browser fullscreen exit (Esc, F11, etc.) → sync state.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    if (typeof document === "undefined") return;
    if (!presenting) {
      try {
        const p = document.documentElement.requestFullscreen?.();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {
        // fullscreen unavailable — still enter presenting layout
      }
      setPresenting(true);
    } else {
      try {
        if (document.fullscreenElement) {
          const p = document.exitFullscreen?.();
          if (p && typeof p.catch === "function") p.catch(() => {});
        }
      } catch {
        // ignore
      }
      setPresenting(false);
    }
  }, [presenting]);

  return (
    <PresentContext.Provider value={{ presenting, toggle }}>
      {children}
    </PresentContext.Provider>
  );
}

export function PresentButton() {
  const { presenting, toggle } = usePresent();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={presenting}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        borderRadius: 10,
        border: presenting ? "1px solid #E31F36" : "1px solid #E7E7EC",
        background: presenting ? "#E31F36" : "#FFFFFF",
        color: presenting ? "#FFFFFF" : "#101014",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        lineHeight: 1,
      }}
    >
      {presenting ? (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M6 2v2.5A1.5 1.5 0 0 1 4.5 6H2M10 2v2.5A1.5 1.5 0 0 0 11.5 6H14M6 14v-2.5A1.5 1.5 0 0 0 4.5 10H2M10 14v-2.5a1.5 1.5 0 0 1 1.5-1.5H14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M9.5 2H14v4.5M14 2 9 7M6.5 14H2V9.5M2 14l5-5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {presenting ? "Exit" : "Present"}
    </button>
  );
}
