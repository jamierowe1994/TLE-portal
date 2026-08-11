"use client";

// Admin tab: Compliance — live from REX.
//
// WHAT FOLLOWS THE MONTH PICKER AND WHAT CAN'T. Measured on the live account,
// 11 Aug 2026, and the reasoning is in lib/rex-stats.ts:
//
//   • REX edits a compliance entry IN PLACE when a certificate is renewed —
//     6,426 of 6,467 (property, type) pairs hold exactly one entry. So today's
//     expiry date is the ONLY one REX has, and rewinding "overdue" to a past
//     month would report a renewed property as having been compliant during
//     the months it was actually overdue. Wrong in the dangerous direction.
//   • The record itself only starts in November 2025 (2,554 entries created
//     that month — the EPC bulk import — against 87 in the whole of the
//     preceding year). A past month would look clean because nobody had typed
//     it in yet.
//
// So the STOCK is as at today and stamped. The two FLOWS — recorded in the
// month, expiring in the month — come straight off dates REX holds, and those
// do follow the picker.

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import type { SeedData } from "@/lib/seed-data"; // type-only — erased at build
import type { ComplianceAgentRow, ComplianceTypeRow } from "@/lib/seed-types";
import { formatPct, monthLabel } from "@/lib/format";

interface BucketRow {
  key: string;
  label: string;
  total: number;
  overdue: number;
  upcoming: number;
}
interface AgentRowLive extends BucketRow {
  pctOverdue: number;
  recorded: number;
  expiring: number;
}
interface LiveCompliance {
  asAt: string;
  month: string;
  totalItems: number;
  overdue: number;
  upcoming: number;
  valid: number;
  noExpiry: number;
  byType: BucketRow[];
  byAgent: AgentRowLive[];
  recordedInMonth: number;
  expiringInMonth: number;
  recordedSeries: Array<{ month: string; recorded: number; expiring: number }>;
  otherBusinesses: number;
  unattributed: number;
  contactEntries: number;
  impossibleDates: number;
  agentsResolved: boolean;
  tleScoped: boolean;
}

const pct = (n: number, total: number) =>
  total ? `${((n / total) * 100).toFixed(1)}%` : "—";

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function PctOverdueBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${clamped >= 75 ? "bg-accent" : clamped >= 40 ? "bg-amber-400" : "bg-green-500"}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="w-10 text-right tnum">{formatPct(pct)}</span>
    </div>
  );
}

/* ------------------------------ live columns ------------------------------ */

const LIVE_TYPE_COLUMNS: DataTableColumn<Record<string, unknown>>[] = [
  { key: "label", label: "Certificate type" },
  { key: "total", label: "Held", align: "right" },
  {
    key: "overdue",
    label: "Overdue",
    align: "right",
    render: (r) => (
      <span className={Number(r.overdue) > 0 ? "font-semibold text-accent" : undefined}>
        {String(r.overdue)}
      </span>
    ),
  },
  { key: "upcoming", label: "Next 60 days", align: "right" },
  {
    key: "pct",
    label: "% overdue",
    align: "right",
    render: (r) => (
      <PctOverdueBar pct={Number(r.total) ? (Number(r.overdue) / Number(r.total)) * 100 : 0} />
    ),
  },
];

/* ---------------------------- snapshot columns ---------------------------- */

const TYPE_COLUMNS: DataTableColumn<ComplianceTypeRow & Record<string, unknown>>[] = [
  {
    key: "type",
    label: "Certificate type",
    render: (r) => (
      <span className={r.type === "Total" ? "font-semibold" : undefined}>{r.type}</span>
    ),
  },
  { key: "total", label: "Total", align: "right" },
  {
    key: "overdue",
    label: "Overdue",
    align: "right",
    render: (r) => <span className={r.overdue > 0 ? "font-semibold text-accent" : undefined}>{r.overdue}</span>,
  },
  { key: "upcoming", label: "Upcoming", align: "right" },
];

const AGENT_COLUMNS: DataTableColumn<ComplianceAgentRow & Record<string, unknown>>[] = [
  {
    key: "agent",
    label: "Partner",
    render: (r) => (
      <span className={r.agent === "Total" ? "font-semibold" : undefined}>{r.agent}</span>
    ),
  },
  { key: "total", label: "Total", align: "right" },
  {
    key: "overdue",
    label: "Overdue",
    align: "right",
    render: (r) => <span className={r.overdue > 0 ? "font-semibold text-accent" : undefined}>{r.overdue}</span>,
  },
  { key: "upcoming", label: "Upcoming", align: "right" },
  {
    key: "pctOverdue",
    label: "% overdue",
    align: "right",
    render: (r) => <PctOverdueBar pct={r.pctOverdue} />,
  },
];

export default function ComplianceTab({ month, seed }: { month: string; seed: SeedData }) {
  const c = seed.compliance;

  // The REX sweep is ~65 pages at ~13s each, batched eight at a time — roughly
  // two minutes cold, instant once cached. Poll rather than blocking the tab,
  // and gate on the month so a slow answer can't land under a heading the user
  // has already navigated away from.
  const [live, setLive] = useState<LiveCompliance | null>(null);
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const ask = () => {
      fetch(`/api/admin/compliance-live?month=${encodeURIComponent(month)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { month?: string; compliance?: LiveCompliance | null }) => {
          if (cancelled || (d.month && d.month !== month)) return;
          if (d.compliance) setLive(d.compliance);
          else if (tries++ < 40) setTimeout(ask, 5000);
        })
        .catch(() => {});
    };
    ask();
    return () => {
      cancelled = true;
    };
  }, [month]);

  const agentRows = live
    ? [
        ...live.byAgent,
        {
          key: "__total",
          label: "Total",
          total: live.byAgent.reduce((t, a) => t + a.total, 0),
          overdue: live.byAgent.reduce((t, a) => t + a.overdue, 0),
          upcoming: live.byAgent.reduce((t, a) => t + a.upcoming, 0),
          recorded: live.byAgent.reduce((t, a) => t + a.recorded, 0),
          expiring: live.byAgent.reduce((t, a) => t + a.expiring, 0),
          pctOverdue: (() => {
            const t = live.byAgent.reduce((s, a) => s + a.total, 0);
            const o = live.byAgent.reduce((s, a) => s + a.overdue, 0);
            return t ? (o / t) * 100 : 0;
          })(),
        },
      ]
    : [];

  const LIVE_AGENT_COLUMNS: DataTableColumn<Record<string, unknown>>[] = [
    {
      key: "label",
      label: "Partner",
      render: (r) => (
        <span className={r.key === "__total" ? "font-semibold" : undefined}>{String(r.label)}</span>
      ),
    },
    { key: "total", label: "Held", align: "right" },
    {
      key: "overdue",
      label: "Overdue",
      align: "right",
      render: (r) => (
        <span className={Number(r.overdue) > 0 ? "font-semibold text-accent" : undefined}>
          {String(r.overdue)}
        </span>
      ),
    },
    { key: "upcoming", label: "Next 60 days", align: "right" },
    {
      key: "recorded",
      label: `Recorded ${monthLabel(month)}`,
      align: "right",
    },
    {
      key: "expiring",
      label: `Expires ${monthLabel(month)}`,
      align: "right",
    },
    {
      key: "pctOverdue",
      label: "% overdue",
      align: "right",
      render: (r) => <PctOverdueBar pct={Number(r.pctOverdue)} />,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Source banner */}
      {live ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
          <span className="font-semibold">Live from REX — read {stamp(live.asAt)}.</span>{" "}
          {live.totalItems.toLocaleString("en-GB")} property certificates on TLE properties,{" "}
          <span className="font-semibold">{live.overdue}</span> overdue and {live.upcoming} due
          within 60 days.
          {live.tleScoped ? null : (
            <>
              {" "}
              <span className="font-semibold">
                REX wouldn&rsquo;t name the partner list this time, so this covers every lettings
                property in the shared account — not just TLE&rsquo;s.
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <span className="font-semibold">Sweeping REX for compliance…</span> Around two minutes
          cold — every entry in the account, read once and kept for six hours. Showing the
          11 Jul 2026 snapshot until it lands.
        </div>
      )}

      {/* Why the stock doesn't move with the picker. This is not a caveat for
          its own sake: the obvious rewind (compare today's expiry date against
          a past date) reports a RENEWED property as having been compliant
          during the months it was overdue, which is wrong in the direction
          that gets someone hurt. */}
      <div className="rounded-2xl border border-line bg-card px-4 py-3 text-[13px] text-muted">
        <strong className="text-ink">Valid, expiring and overdue are as at today</strong> — for
        any month you pick. REX overwrites a certificate&rsquo;s record when it is renewed rather
        than keeping the old one (6,426 of 6,467 property/type pairs hold exactly one entry), so
        the only expiry date it holds is the current one. Rewinding it would show a property that
        was overdue in February as having been fine. What <em>is</em> honestly month-scoped is
        below: what was <strong>recorded</strong> that month and what <strong>expires</strong> in
        it — both read straight off dates REX holds.
      </div>

      {/* Stock — as at today */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-sm font-semibold">Where the book stands — today</h2>
          {live ? (
            <span className="text-[11px] text-muted">
              {live.valid.toLocaleString("en-GB")} valid ·{" "}
              {live.noExpiry.toLocaleString("en-GB")} with no expiry date recorded
            </span>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Property certificates"
            stat={
              live
                ? {
                    value: live.totalItems,
                    source: "live-rex",
                    note: "Every active property compliance entry in REX. Contact-level checks (ID, AML, right to rent) are excluded — different job.",
                  }
                : c.totals.totalItems
            }
            big
          />
          <StatCard
            label="Overdue"
            stat={
              live
                ? { value: live.overdue, source: "live-rex", note: "Past their expiry date, as at the read above." }
                : c.totals.overdue
            }
            big
            sub={live ? `${pct(live.overdue, live.totalItems)} of the book` : "50.7% of total"}
          />
          <StatCard
            label="Due in 60 days"
            stat={
              live
                ? { value: live.upcoming, source: "live-rex", note: "Expiring within the next 60 days." }
                : c.totals.upcoming
            }
            big
            sub={live ? `${pct(live.upcoming, live.totalItems)} of the book` : "49.3% of total"}
          />
          <StatCard
            label="No expiry recorded"
            stat={
              live
                ? {
                    value: live.noExpiry,
                    source: "live-rex",
                    note: "REX holds the entry but no expiry date, so it can be flagged neither valid nor overdue. These are invisible to any reminder that runs off dates.",
                  }
                : {
                    value: null,
                    source: "snapshot",
                    note: "Not in the July snapshot — this one only exists once REX has been read.",
                  }
            }
            big
            sub={live ? `${pct(live.noExpiry, live.totalItems)} — can't be reminded on` : undefined}
          />
        </div>
      </section>

      {/* Flows — these DO follow the picker */}
      {live ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-sm font-semibold">{monthLabel(month)} — the month itself</h2>
            <span className="text-[11px] text-muted">
              live from REX · this section follows the month picker
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              label={`Recorded in ${monthLabel(month)}`}
              stat={{
                value: live.recordedInMonth,
                source: "live-rex",
                note: "Compliance entries created in REX during this month — the admin actually done. Bulk imports show up here as a spike (November 2025 carries 2,554).",
              }}
              big
            />
            <StatCard
              label={`Expiring in ${monthLabel(month)}`}
              stat={{
                value: live.expiringInMonth,
                source: "live-rex",
                note: "Certificates whose expiry date falls in this month — the only compliance figure that can be read forward, so it is the one to plan against.",
              }}
              big
            />
          </div>
          <DataTable
            columns={[
              { key: "month", label: "Month", render: (r) => monthLabel(String(r.month)) },
              { key: "recorded", label: "Recorded", align: "right" },
              { key: "expiring", label: "Expiring", align: "right" },
            ]}
            rows={live.recordedSeries as unknown as Record<string, unknown>[]}
            compact
          />
          <p className="text-[11px] text-muted">
            Twelve months ending {monthLabel(month)}. Months after today under
            &ldquo;expiring&rdquo; are a forecast off dates already held — nothing is projected.
          </p>
        </section>
      ) : null}

      {/* By type */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">By certificate type</h2>
        {live ? (
          <>
            <DataTable
              columns={LIVE_TYPE_COLUMNS}
              rows={live.byType as unknown as Record<string, unknown>[]}
              compact
            />
            <p className="text-[11px] text-muted">
              Live from REX, as at {stamp(live.asAt)}. Held = entries on record, not properties —
              a property with two EPCs counts twice.
            </p>
          </>
        ) : (
          <DataTable columns={TYPE_COLUMNS} rows={[...c.byType, c.byTypeTotal]} compact />
        )}
      </section>

      {/* By partner */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">By partner</h2>
        {live && live.byAgent.length ? (
          <>
            <DataTable
              columns={LIVE_AGENT_COLUMNS}
              rows={agentRows as unknown as Record<string, unknown>[]}
              compact
            />
            <p className="text-[11px] text-muted">
              Attributed through the listing agent REX holds against each property, so these rows
              sum exactly to the totals above — the same entries, split.
            </p>
          </>
        ) : (
          <>
            <DataTable columns={AGENT_COLUMNS} rows={[...c.byAgent, c.byAgentTotal]} compact />
            <p className="text-xs text-muted">{c.source}</p>
          </>
        )}
      </section>

      {/* What the figures deliberately leave out. Six businesses share this REX
          account, so the raw sweep is roughly three times TLE's book — most of
          it EPCs on The Property Experts' sales stock. Counting those would
          make the headline bigger and meaningless, and would put overdue
          certificates on the dashboard that nobody here can chase. */}
      {live ? (
        <section className="rounded-2xl border border-line bg-card px-4 py-3 text-[12px] text-muted">
          <div className="font-semibold text-ink">What this excludes, and why</div>
          <ul className="mt-1.5 space-y-1">
            <li>
              <strong>{live.otherBusinesses.toLocaleString("en-GB")}</strong> certificates on
              lettings properties belonging to another business in this shared REX account.
            </li>
            <li>
              <strong>{live.unattributed.toLocaleString("en-GB")}</strong> on properties no
              current lettings listing claims — sold, archived, or never listed. Mostly EPCs on
              sales stock. Some will be TLE properties whose listing has since been archived, so
              this is the one exclusion that costs us a little coverage; the alternative is
              putting somebody else&rsquo;s overdue gas certificate on a partner&rsquo;s row.
            </li>
            <li>
              <strong>{live.contactEntries.toLocaleString("en-GB")}</strong> contact-level checks
              — ID, right to rent, AML, referencing. A different job that lives in the same REX
              table. Adding them in is why this tile used to read 6,397.
            </li>
            {live.impossibleDates > 0 ? (
              <li>
                {live.impossibleDates}{" "}
                {live.impossibleDates === 1 ? "certificate carries" : "certificates carry"} an
                expiry date that isn&rsquo;t a real year (3033, 8203) — keying slips worth
                correcting in REX. Counted in the book, flagged neither valid nor overdue.
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
