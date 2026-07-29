"use client";

import { useRef, useState } from "react";

// Square photo carousel for the split drawers: arrows to step, drag/swipe to
// flick through, dots for where you are. One photo → no chrome at all.

function Placeholder() {
  // No photos on file → a little Notioly person who's lost the way, sat in
  // the same rounded frame the photo would fill.
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-page">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/illustrations/notioly/lost-the-way.svg"
        alt=""
        aria-hidden
        className="h-[70%] w-auto max-w-[80%] object-contain"
      />
      <span className="text-[11px] text-muted">No photos yet</span>
    </div>
  );
}

export default function PhotoCarousel({
  images,
  alt,
  aspect = "aspect-square",
}: {
  images: string[];
  alt: string;
  /** Shape of the frame, e.g. "aspect-square" (default) or a fixed height. */
  aspect?: string;
}) {
  const [index, setIndex] = useState(0);
  // Drag offset in px while the pointer is down; null when at rest.
  const [drag, setDrag] = useState<number | null>(null);
  const startX = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  const count = images.length;
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i));
  const go = (i: number) => setIndex(clamp(i));

  const onPointerDown = (e: React.PointerEvent) => {
    if (count < 2) return;
    startX.current = e.clientX;
    setDrag(0);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag === null) return;
    setDrag(e.clientX - startX.current);
  };
  const onPointerUp = () => {
    if (drag === null) return;
    const width = box.current?.clientWidth ?? 300;
    // A quarter-width pull commits to the next photo; less snaps back.
    if (drag < -width / 4) go(index + 1);
    else if (drag > width / 4) go(index - 1);
    setDrag(null);
  };

  return (
    <div
      ref={box}
      className={`group relative ${aspect} w-full touch-pan-y select-none overflow-hidden rounded-xl bg-page`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {count === 0 ? (
        <Placeholder />
      ) : (
        <div
          className="flex h-full"
          style={{
            transform: `translateX(calc(${-index * 100}% + ${drag ?? 0}px))`,
            transition: drag === null ? "transform 300ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
          }}
        >
          {images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt={`${alt} — photo ${i + 1}`}
              loading={i === 0 ? "eager" : "lazy"}
              draggable={false}
              className="h-full w-full shrink-0 object-cover"
            />
          ))}
        </div>
      )}

      {count > 1 ? (
        <>
          {index > 0 ? (
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => go(index - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-1.5 text-white opacity-0 backdrop-blur-sm transition hover:bg-black/65 group-hover:opacity-100"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
          ) : null}
          {index < count - 1 ? (
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => go(index + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-1.5 text-white opacity-0 backdrop-blur-sm transition hover:bg-black/65 group-hover:opacity-100"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          ) : null}

          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
            {images.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-4 bg-white" : "w-1.5 bg-white/60"
                }`}
              />
            ))}
          </div>
          <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            {index + 1}/{count}
          </span>
        </>
      ) : null}
    </div>
  );
}
