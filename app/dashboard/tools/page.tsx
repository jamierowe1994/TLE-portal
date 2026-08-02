"use client";

// Tools — the catch-all for things the agent's business needs that aren't a
// board or a report. This route used to be the platform-links grid; those
// moved into the TLE OS launcher on the rail when the All Tools button went,
// which left the route free for what it should have been.

import Link from "next/link";
import DoodleIcon from "@/components/DoodleIcon";

const enterAt = (ms: number) =>
  ({ "--enter-delay": `${ms}ms` }) as React.CSSProperties;

const TOOLS: Array<{
  href: string | null;
  icon: string;
  name: string;
  blurb: string;
  status?: string;
}> = [
  {
    // First on purpose: it is the one that saves real time every month.
    // Not linked until it exists — see the note in the commit; the fee basis
    // is a business rule nobody has written down yet.
    href: null,
    icon: "doc",
    name: "Invoicing",
    blurb:
      "Pick a completed deal, check the figures, and produce an invoice in your own business's name — ready for accounts.",
    status: "Building now",
  },
  {
    href: "/dashboard/forecast",
    icon: "trend-up",
    name: "Forecasting",
    blurb: "Model the months ahead from your own pipeline and pick your targets apart.",
  },
  {
    href: null,
    icon: "piggy-bank",
    name: "Profit & loss",
    blurb: "Your income against your costs, month by month.",
    status: "Coming next",
  },
];

export default function ToolsPage() {
  return (
    <div className="space-y-6">
      <div className="pt-2">
        <h1
          className="tracking-tight"
          style={{ fontSize: "clamp(32px, 3.6vw, 46px)", lineHeight: 1.05, fontWeight: 500 }}
        >
          Tools
        </h1>
        <p className="mt-2.5 text-[13px] text-muted">
          Built for your business, not the agency&apos;s.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {TOOLS.map((t, i) => {
          const inner = (
            <>
              <span className="text-accent">
                <DoodleIcon name={t.icon} size={26} />
              </span>
              <h2 className="mt-4 text-[17px]" style={{ fontWeight: 500 }}>
                {t.name}
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t.blurb}</p>
              {t.status ? (
                <span className="mt-3 inline-block rounded-full border border-line px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {t.status}
                </span>
              ) : null}
            </>
          );
          const shell =
            "enter enter-up card card-flat block min-h-[190px] p-6 text-left transition";
          // A tool that isn't built yet is not a link — a dead link that looks
          // live is worse than an honest "coming next".
          return t.href ? (
            <Link
              key={t.name}
              href={t.href}
              className={`${shell} btn-press hover:border-black/25`}
              style={enterAt(120 + i * 60)}
            >
              {inner}
            </Link>
          ) : (
            <div key={t.name} className={`${shell} opacity-60`} style={enterAt(120 + i * 60)}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
