"use client";

import { useState } from "react";

// Controlled password field with a show/hide (eye) toggle. Zero deps.

export default function PasswordInput({
  value,
  onChange,
  placeholder = "Password",
  className = "",
  autoFocus = false,
  disabled = false,
  onEnter,
  underline = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onEnter?: () => void;
  /** A ruled line to type on instead of a box — for surfaces where a bordered
   *  field would need its own fill to read against the page colour. */
  underline?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`relative ${className}`}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) onEnter();
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        autoComplete="current-password"
        className={
          underline
            ? "w-full border-0 border-b-[1.5px] border-ink/25 bg-transparent px-1 py-2.5 pr-11 text-sm text-ink outline-none transition focus:border-ink/70 disabled:opacity-60"
            : "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 pr-11 text-sm text-ink outline-none transition focus:border-gray-400 disabled:opacity-60"
        }
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted transition hover:bg-gray-50 hover:text-ink"
      >
        {visible ? (
          <svg
            className="h-4.5 w-4.5"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg
            className="h-4.5 w-4.5"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
