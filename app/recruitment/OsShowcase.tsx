"use client";

import DoodleIcon from "@/components/DoodleIcon";

// The hero's feature piece: TLE OS itself, drawn rather than screenshotted.
//
// A real screenshot would carry live landlord and tenant data onto a public
// marketing page, would need re-taking every time the UI moves, and would be a
// blurry raster on a retina display. This is built from the same tokens as the
// product, so it is crisp at any size, contains no real people, and stays
// honest — every panel below exists in the actual portal.
//
// It is decoration, not a control surface: nothing here is focusable and the
// whole thing is hidden from screen readers.

const NAV = [
  { icon: "dashboard", label: "Dashboard" },
  { icon: "home-1", label: "My Properties" },
  { icon: "list", label: "Applications" },
  { icon: "shield", label: "Compliance", active: true },
  { icon: "suitcase", label: "My Portfolio" },
  { icon: "wallet", label: "Tools" },
];

const PROPS = [
  { name: "Flat 2, 14A High Street", where: "Torquay TQ1", dots: ["ok", "ok", "warn"], badge: "1 OUTSTANDING", tone: "warn" },
  { name: "22 Moor Street", where: "Rugby CV21", dots: ["ok", "ok", "ok"], badge: "ALL CLEAR", tone: "ok" },
  { name: "9 Penfield Gardens", where: "Bristol BS6", dots: ["ok", "bad", "ok"], badge: "1 EXPIRED", tone: "bad" },
];

const DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
};
const BADGE: Record<string, string> = {
  ok: "border-line bg-page text-muted",
  warn: "border-amber-200 bg-amber-50 text-amber-700",
  bad: "border-red-200 bg-red-50 text-red-700",
};

export default function OsShowcase() {
  return (
    <div aria-hidden className="pointer-events-none select-none">
      <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-[0_30px_80px_-40px_rgba(16,16,20,0.45)]">
        {/* window chrome — enough to read as an app, not a fake browser */}
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
          <span className="ml-3 rounded-md bg-page px-2.5 py-0.5 text-[10px] text-muted">
            partner.thelettingexperts.co.uk
          </span>
        </div>

        <div className="flex">
          {/* rail */}
          <div className="hidden w-[176px] shrink-0 border-r border-line p-3 sm:block">
            <p className="written px-2 pb-3 text-[15px]">TLE OS</p>
            {NAV.map((n) => (
              <div
                key={n.label}
                className={`mb-0.5 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[11.5px] ${
                  n.active ? "bg-page font-medium text-ink" : "text-muted"
                }`}
              >
                <DoodleIcon name={n.icon} size={13} />
                {n.label}
              </div>
            ))}
          </div>

          {/* body */}
          <div className="min-w-0 flex-1 p-4 sm:p-5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[15px] font-medium sm:text-[17px]">Compliance</p>
                <p className="text-[10.5px] text-muted">Worst first, across your properties</p>
              </div>
              <span className="rounded-full bg-accent px-2.5 py-1 text-[9.5px] font-semibold text-white">
                3 need chasing
              </span>
            </div>

            {/* stat strip */}
            <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Properties", "38"],
                ["Rent roll", "£41,900"],
                ["In date", "92%"],
                ["Renewals 30d", "4"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line px-2.5 py-2">
                  <p className="text-[13px] font-semibold leading-none sm:text-[15px]">{value}</p>
                  <p className="mt-1 text-[9.5px] text-muted">{label}</p>
                </div>
              ))}
            </div>

            {/* property rows */}
            <div className="mt-3 space-y-2">
              {PROPS.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11.5px] font-medium">{p.name}</p>
                    <p className="truncate text-[10px] text-muted">{p.where}</p>
                  </div>
                  <div className="hidden items-center gap-1 sm:flex">
                    {p.dots.map((d, i) => (
                      <span key={i} className={`h-1.5 w-1.5 rounded-full ${DOT[d]}`} />
                    ))}
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[8.5px] font-semibold ${BADGE[p.tone]}`}
                  >
                    {p.badge}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* A lead landing, floated over the edge — the one thing the page most
          wants to say, said by the product rather than by a bullet point.
          Sits against the property rows, NOT the stat strip: at the original
          height it covered the fourth figure, so the panel was showing off by
          hiding its own content. */}
      <div className="showcase-lead absolute -right-5 top-[48%] hidden w-[228px] rounded-2xl border border-line bg-card p-3.5 shadow-[0_18px_40px_-18px_rgba(16,16,20,0.35)] lg:block">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-wide accent-text">New lead</p>
        </div>
        <p className="mt-1.5 text-[12px] font-medium">3-bed semi, Kings Heath</p>
        <p className="text-[10.5px] text-muted">Landlord enquiry · valuation requested</p>
      </div>
    </div>
  );
}
