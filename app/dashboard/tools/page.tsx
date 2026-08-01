"use client";

// TLE OS — one place for every system the agent's business runs on. Links for
// now; the ones marked "Connected" already feed figures into this portal.

import { PLATFORM_SECTIONS, platformsIn, type Platform } from "@/lib/platforms";

const enterAt = (ms: number) =>
  ({ "--enter-delay": `${ms}ms` }) as React.CSSProperties;

function ExternalIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path d="M14 5h5v5M19 5l-7 7M18 13v5a1 1 0 01-1 1H6a1 1 0 01-1-1V7a1 1 0 011-1h5" />
    </svg>
  );
}

function PlatformCard({ p, delay }: { p: Platform; delay: number }) {
  // Monochrome chip — the per-platform brand colours were the loudest thing on
  // the page; ink-on-grey keeps the grid readable and on-theme.
  const chip = (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/[0.05] text-[13px] font-semibold text-ink"
      aria-hidden
    >
      {p.name.slice(0, 2).toUpperCase()}
    </span>
  );

  const body = (
    <>
      <div className="flex items-start gap-3">
        {chip}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{p.name}</span>
            {p.connected ? (
              <span className="rounded-full border border-green-200 bg-green-50 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-green-700">
                CONNECTED
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{p.blurb}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[12px] font-medium">
        {p.url ? (
          <span className="inline-flex items-center gap-1.5 text-ink">
            Open <ExternalIcon />
          </span>
        ) : (
          <span className="text-muted">Link coming</span>
        )}
      </div>
    </>
  );

  if (!p.url) {
    return (
      <div className="enter enter-up card card-flat p-5 opacity-70" style={enterAt(delay)}>
        {body}
      </div>
    );
  }
  return (
    <a
      href={p.url}
      target="_blank"
      rel="noopener noreferrer"
      className="enter enter-up card card-flat btn-press block p-5 transition hover:border-black/20"
      style={enterAt(delay)}
    >
      {body}
    </a>
  );
}

export default function ToolsPage() {
  let beat = 120;

  return (
    <div className="space-y-8">
      <div className="enter enter-up" style={enterAt(60)}>
        <h1 className="text-xl font-semibold tracking-tight">TLE OS</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-muted">
          Every system your business runs on, in one place. The ones marked{" "}
          <span className="font-medium text-ink">Connected</span> already feed
          figures into this portal — the rest open in a new tab for now.
        </p>
      </div>

      {PLATFORM_SECTIONS.map((section) => {
        const items = platformsIn(section.id);
        return (
          <section key={section.id}>
            <div className="enter enter-up mb-3" style={enterAt((beat += 60))}>
              <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                {section.title}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted">{section.blurb}</p>
            </div>
            {items.length === 0 ? (
              <div className="card card-flat p-5 text-[13px] text-muted">
                Nothing here yet — this is where your {section.title.toLowerCase()}{" "}
                will live.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((p) => (
                  <PlatformCard key={p.id} p={p} delay={(beat += 70)} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
