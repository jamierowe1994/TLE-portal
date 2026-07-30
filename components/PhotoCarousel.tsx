"use client";

import { useRef, useState } from "react";
import NoPhoto from "@/components/NoPhoto";

// Photo carousel for the record drawers: arrows to step, drag/swipe to flick
// through, dots for where you are. One photo → no chrome at all.
//
// Two dressings. The default keeps the arrows floating over the photo (the
// compact drawers). `arrowsOutside` lifts them clear of the frame as bare
// hand-drawn strokes on the page — no pill, no backdrop — with an optional
// thumbnail strip underneath.

function Placeholder() {
  return <NoPhoto label="No photos yet" className="border-0" fit="contain" />;
}

/** A sketched arrow — drawn slightly off-true so it reads as ink, not UI. */
function InkArrow({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 34 34"
      className={`h-8 w-8 ${dir === "right" ? "-scale-x-100" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* shaft, with a touch of wobble */}
      <path d="M27.5 16.8c-6.2-.5-12.4-.7-18.6-.4" />
      {/* head */}
      <path d="M15.4 9.6c-2.6 2.2-4.9 4.5-6.8 6.9 2.2 2.2 4.6 4.2 7.1 6" />
    </svg>
  );
}

export default function PhotoCarousel({
  images,
  alt,
  aspect = "aspect-square",
  arrowsOutside = false,
  thumbs = false,
}: {
  images: string[];
  alt: string;
  /** Shape of the frame, e.g. "aspect-square" (default) or a fixed height. */
  aspect?: string;
  /** Bare ink arrows either side of the frame instead of over the photo. */
  arrowsOutside?: boolean;
  /** Thumbnail strip under the frame. */
  thumbs?: boolean;
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

  const frame = (
    <div
      ref={box}
      className={`group relative ${aspect} w-full touch-pan-y select-none overflow-hidden rounded-2xl bg-page`}
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

      {count > 1 && !arrowsOutside ? (
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
        </>
      ) : null}

      {count > 1 ? (
        <>
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

  if (!arrowsOutside) return frame;

  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous photo"
          onClick={() => go(index - 1)}
          disabled={index === 0 || count < 2}
          className="btn-press shrink-0 text-ink transition disabled:pointer-events-none disabled:opacity-20"
        >
          <InkArrow dir="left" />
        </button>
        <div className="min-w-0 flex-1">{frame}</div>
        <button
          type="button"
          aria-label="Next photo"
          onClick={() => go(index + 1)}
          disabled={index >= count - 1}
          className="btn-press shrink-0 text-ink transition disabled:pointer-events-none disabled:opacity-20"
        >
          <InkArrow dir="right" />
        </button>
      </div>

      {thumbs && count > 1 ? (
        // Sits under the frame, inset to line up with the photo's edges.
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto px-9">
          {images.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-label={`Photo ${i + 1}`}
              className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                i === index ? "border-ink" : "border-transparent opacity-70 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
