"use client";

/**
 * Where on screen a drawer should grow from.
 *
 * Every card that opens a drawer calls this from its own click event; the
 * centre of that card becomes the drawer's transform-origin, so the panel
 * expands out of the tile rather than landing on top of it.
 *
 * Deliberately reads the CURRENT bounding box at click time rather than
 * storing one: tiles move (filters, sorts, the grid reflowing), and an origin
 * captured on render would point somewhere the card no longer is.
 */
export function zoomOriginFrom(e: { currentTarget: Element }): { x: number; y: number } {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export type ZoomOrigin = { x: number; y: number } | null;
