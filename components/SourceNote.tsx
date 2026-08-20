"use client";

import { useState } from "react";

// Where a figure came from, next to the figure.
//
// This used the browser's own `title`, which technically works and practically
// does not: about a second of delay, no styling, and it wraps a long sentence
// into an unreadable strip. Nobody waited long enough to see one, so the mark
// looked decorative. It is a real tooltip now — instant, readable, and wide
// enough for a sentence that actually explains the source.
export default function SourceNote({
  children,
  tone = "live",
}: {
  /** Say the SYSTEM and the QUERY, not just the vendor. "PayProp
   *  report/tenant/balances, negative balances only" answers the question;
   *  "PayProp" invites the follow-up. */
  children: string;
  tone?: "live" | "snapshot" | "derived";
}) {
  const [show, setShow] = useState(false);
  const colour =
    tone === "live"
      ? "text-green-600/80 hover:text-green-700"
      : tone === "derived"
        ? "text-slate-500/80 hover:text-slate-600"
        : "text-amber-600/80 hover:text-amber-700";
  const prefix =
    tone === "live" ? "Live" : tone === "derived" ? "Worked out here" : "Snapshot";

  return (
    <span className="source-badge relative inline-block align-middle">
      <button
        type="button"
        aria-label={`Where this comes from: ${prefix}. ${children}`}
        className={`cursor-help text-[12px] leading-none ${colour}`}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        onClick={(e) => {
          // Tap opens it on a touch screen, where there is no hover at all.
          e.preventDefault();
          e.stopPropagation();
          setShow((v) => !v);
        }}
      >
        ⓘ
      </button>
      {show ? (
        <span
          role="tooltip"
          className="absolute left-1/2 top-[140%] z-50 w-[19rem] -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-left text-[11.5px] font-normal leading-relaxed text-white shadow-lg"
        >
          <span className="mb-0.5 block text-[9.5px] font-semibold uppercase tracking-wider text-white/60">
            {prefix}
          </span>
          {children}
        </span>
      ) : null}
    </span>
  );
}
