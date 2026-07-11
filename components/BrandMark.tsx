"use client";

import { useState } from "react";
import { BRAND } from "@/lib/brand";

// TLE logo with a letter-mark fallback ("TLE" on the accent red) if the image
// asset is missing or fails to load. Logo filenames contain spaces → encodeURI.

export default function BrandMark({
  size = 32,
  rounded = "rounded-lg",
  className = "",
  white = false,
}: {
  size?: number;
  rounded?: string;
  className?: string;
  /** Use the white logo variant (for dark/presenting surfaces). */
  white?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = white ? BRAND.logoWhite : BRAND.logo;

  if (failed) {
    return (
      <span
        className={`inline-flex items-center justify-center font-semibold text-white ${rounded} ${className}`}
        style={{
          width: size,
          height: size,
          backgroundColor: BRAND.accent,
          fontSize: Math.max(10, Math.round(size * 0.34)),
          letterSpacing: "-0.02em",
        }}
        aria-label={BRAND.name}
      >
        {BRAND.shortName}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={encodeURI(src)}
      alt={BRAND.name}
      width={size}
      height={size}
      className={`${rounded} object-contain ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
