"use client";

import { useEffect, useState } from "react";

// A document, opened in place.
//
// Certificates used to open in a new browser tab, which drops the agent out of
// the portal and leaves them to find their way back. This slides up from the
// bottom instead: the page stays behind it, Escape or the backdrop closes it,
// and Download is there for the times they actually want the file.
//
// The src is always our own /api/compliance/document route, never REX's URL —
// see that route for why.

export interface SheetDoc {
  /** Our proxy URL for the bytes. */
  src: string;
  title: string;
  subtitle?: string | null;
  /** Images render as <img>; anything else goes in an <iframe> (PDF viewer). */
  kind?: "image" | "file";
}

export default function DocumentSheet({
  doc,
  onClose,
}: {
  doc: SheetDoc | null;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [failed, setFailed] = useState(false);

  // Drive the transition from a state flip one frame after mount, so the panel
  // animates in rather than appearing already-open.
  useEffect(() => {
    if (!doc) {
      setShown(false);
      return;
    }
    setFailed(false);
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [doc]);

  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // The sheet covers the page; letting the page behind it scroll is
    // disorienting on a long compliance list.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [doc, onClose]);

  if (!doc) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-[2px] transition-opacity duration-200"
        style={{ opacity: shown ? 1 : 0 }}
      />
      <div
        className="relative flex h-[88vh] flex-col rounded-t-2xl border-t border-line bg-white shadow-2xl transition-transform duration-300 ease-out"
        style={{ transform: shown ? "translateY(0)" : "translateY(100%)" }}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium text-ink">{doc.title}</p>
            {doc.subtitle ? (
              <p className="truncate text-[11px] text-muted">{doc.subtitle}</p>
            ) : null}
          </div>
          <a
            href={doc.src}
            download
            className="btn-press shrink-0 rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink transition hover:border-black/25"
          >
            Download
          </a>
          <button
            onClick={onClose}
            className="btn-press shrink-0 rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink transition hover:border-black/25"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 bg-[#f6f6f4]">
          {failed ? (
            <div className="flex h-full items-center justify-center px-6">
              <p className="text-center text-[13px] text-muted">
                Couldn&apos;t open this one.{" "}
                <a href={doc.src} download className="underline underline-offset-2">
                  Download it instead
                </a>
                .
              </p>
            </div>
          ) : doc.kind === "image" ? (
            <div className="flex h-full items-center justify-center overflow-auto p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={doc.src}
                alt={doc.title}
                onError={() => setFailed(true)}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ) : (
            <iframe
              src={doc.src}
              title={doc.title}
              onError={() => setFailed(true)}
              className="h-full w-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}
