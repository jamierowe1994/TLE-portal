"use client";

// A Notioly figure beside a page title, with one small piece of life in it.
//
// Every dashboard page had the same bare heading, and the illustrations we own
// were only used on the dashboard, to-dos, profile and login. This puts one
// against the working pages too — the same treatment My Properties already had,
// so it reads as a family rather than a decoration bolted on.
//
// Deliberately hidden below lg: at tablet width the heading and the figure
// fight for the same row and the figure wins, which is the wrong outcome for a
// page somebody opened to do a job.

const ART: Record<string, { src: string; motion: "float" | "sway" | "pulse" }> = {
  compliance: { src: "/illustrations/notioly/checklist.svg", motion: "sway" },
  applications: { src: "/illustrations/notioly/looking-for-something.svg", motion: "float" },
  portfolio: { src: "/illustrations/notioly/buildings.svg", motion: "float" },
};

export default function PageArt({
  name,
  className = "",
}: {
  name: keyof typeof ART | string;
  className?: string;
}) {
  const art = ART[name];
  if (!art) return null;
  return (
    <div
      aria-hidden
      className={`pointer-events-none hidden shrink-0 lg:block ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={art.src} alt="" className={`w-full page-art page-art-${art.motion}`} />
    </div>
  );
}
