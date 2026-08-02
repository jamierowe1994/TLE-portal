"use client";

import { useEffect, useRef, useState } from "react";

// A quiet corner control for trying the portal's type on for size. Sets
// data-font on <html>; the schemes themselves live in globals.css. The
// choice is remembered per browser, so it survives a reload while everyone
// makes their mind up.
//
// It reaches the PARTNER FRONT END only. Susan's admin centre and Kirstie's
// pre-tenancy board are pinned to Montserrat whatever this is set to, so the
// control isn't mounted there — a button that visibly does nothing is worse
// than no button.

const KEY = "tle-font-scheme";

const OPTIONS = [
  {
    key: "default",
    label: "As designed",
    note: "Handwritten titles and figures",
    sample: "var(--font-shantell)",
  },
  {
    key: "half",
    label: "Half",
    note: "Handwritten titles, the rest Montserrat",
    sample: "var(--font-shantell)",
  },
  {
    key: "branded",
    label: "Branded",
    note: "Montserrat throughout",
    sample: "var(--font-montserrat)",
  },
] as const;

type Scheme = (typeof OPTIONS)[number]["key"];

/** Applied on mount too, so a reload keeps whatever was being trialled. */
function apply(scheme: Scheme) {
  const root = document.documentElement;
  // "default" means no override at all, so each surface keeps the type it was
  // designed with — handwritten titles on the partner front end, the website
  // face in admin and pre-tenancy.
  if (scheme === "default") root.removeAttribute("data-font");
  else root.setAttribute("data-font", scheme);
}

export default function FontSwitcher() {
  const [scheme, setScheme] = useState<Scheme>("default");
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(KEY) as Scheme | null;
    if (saved && OPTIONS.some((o) => o.key === saved)) {
      setScheme(saved);
      apply(saved);
    }
  }, []);

  const close = () => {
    setOpen(false);
    setClosing(true);
    window.setTimeout(() => setClosing(false), 240);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (next: Scheme) => {
    setScheme(next);
    apply(next);
    window.localStorage.setItem(KEY, next);
  };

  return (
    <div ref={wrap} className="fixed bottom-4 right-4 z-40 print:hidden">
      {open || closing ? (
        <div
          className={`${
            closing ? "shrink-up" : "swing-down"
          } absolute bottom-[calc(100%+0.6rem)] right-0 w-[248px] origin-bottom-right overflow-hidden rounded-2xl border border-line bg-card p-1.5 shadow-xl`}
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Try a typeface
          </p>
          {OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => pick(o.key)}
              className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-page ${
                scheme === o.key ? "bg-page" : ""
              }`}
            >
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-[15px] text-ink"
                style={{ fontFamily: o.sample }}
              >
                Aa
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">{o.label}</span>
                <span className="block truncate text-[11px] text-muted">{o.note}</span>
              </span>
              {scheme === o.key ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M3 8.5l3.5 3.5L13 5"
                    stroke="#e31f36"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label="Try a different typeface"
        aria-expanded={open}
        className={`btn-press flex h-11 w-11 items-center justify-center rounded-full border border-line bg-card text-ink shadow-lg transition ${
          open ? "border-ink/60" : "hover:border-black/30"
        }`}
      >
        <span className="text-[15px] leading-none" style={{ fontFamily: "var(--font-heading)" }}>
          Aa
        </span>
      </button>
    </div>
  );
}
