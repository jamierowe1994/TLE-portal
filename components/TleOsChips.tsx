"use client";

import { PLATFORMS } from "@/lib/platforms";

// The TLE OS chip box: every app in the registry, thrown up from behind the
// rail's bottom line and tumbled back down behind it.
//
// Extracted so the partner rail and Kirstie's board share one copy. The maths
// is the fiddly part — travel is per ROW so a pair of chips sets off from the
// same height, while the tilts and delays stay per CHIP, which is what makes
// them knock about rather than move as a block. Two copies of that would drift
// the first time either was touched.

const CHIP_LABEL: Record<string, string> = { training: "Training" };
const LAUNCHER = PLATFORMS.map((a) => ({ name: CHIP_LABEL[a.id] ?? a.name, url: a.url }));
const CHIP_COLS = 1;
const CHIP_ROWS = Math.ceil(LAUNCHER.length / CHIP_COLS);

export default function TleOsChips({
  closing,
  line = "border-black/[0.16]",
}: {
  /** True while the box is tumbling shut, so the chips fall instead of pop. */
  closing: boolean;
  /** Border colour, so a rail can match its own hairlines. */
  line?: string;
}) {
  return (
    // One chip per line (was two-up). The full stack is taller than the rail
    // sometimes has left, so the RAIL scrolls it rather than this box hiding
    // it — both rails that mount this are overflow-y-auto.
    <div className="grid grid-cols-1 gap-1.5 pb-2">
      {LAUNCHER.map((c, i) => {
        const tilt = [-7, 6, -5, 8, -6, 5, -8, 4][i % 8];
        const delay = [0, 70, 35, 105, 55, 120, 20, 90][i % 8];
        const travel = (CHIP_ROWS - i) * 34 + 24;
        // truncate does double duty: it ellipsises the long names and, by
        // clipping overflow, stops one widening its grid track past the rail.
        const cls = `${closing ? "chip-fall" : "chip-pop"} block min-w-0 truncate rounded-lg border ${line} bg-white/70 px-2.5 py-1.5 text-[12.5px] font-medium`;
        const style = {
          "--tilt": `${tilt}deg`,
          "--delay": `${delay}ms`,
          "--travel": `${travel}px`,
        } as React.CSSProperties;

        if (!c.url) {
          return (
            <span
              key={c.name}
              title={`${c.name} — link coming`}
              className={`${cls} cursor-default text-muted/50`}
              style={style}
            >
              {c.name}
            </span>
          );
        }
        // Every app in the registry lives outside the portal, so there is no
        // internal-route branch — add one back if that stops being true rather
        // than sending a portal page to a new tab.
        return (
          <a
            key={c.name}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            title={c.name}
            className={`${cls} text-ink transition hover:bg-white`}
            style={style}
          >
            {c.name}
          </a>
        );
      })}
    </div>
  );
}
