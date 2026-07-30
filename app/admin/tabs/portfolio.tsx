"use client";

// Admin tab: Portfolio — overview cards + portfolio-by-partner table.
// PayProp is the source system; no API access yet, so everything is the
// 11 Jul 2026 snapshot. (No portfolio growth time series exists in the
// snapshot, so no growth chart is rendered.)

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import type { SeedData } from "@/lib/seed-data"; // type-only — erased at build
import type { PortfolioRow } from "@/lib/seed-types";
import { formatGBP, monthLabel } from "@/lib/format";

const COLUMNS: DataTableColumn<PortfolioRow & Record<string, unknown>>[] = [
  {
    key: "agent",
    label: "Partner",
    render: (r) => (
      <span className={r.agent === "TOTAL" ? "font-semibold" : undefined}>{r.agent}</span>
    ),
  },
  { key: "managed", label: "Managed", align: "right" },
  { key: "letOnly", label: "Let only", align: "right" },
  {
    key: "total",
    label: "Total",
    align: "right",
    render: (r) => <span className="font-semibold">{r.total.toLocaleString("en-GB")}</span>,
  },
  { key: "rlpLec", label: "RLP / LEC", align: "right" },
  {
    key: "rentRoll",
    label: "Rent roll",
    align: "right",
    render: (r) => (r.rentRoll == null ? "—" : formatGBP(r.rentRoll)),
  },
  {
    key: "avgRent",
    label: "Avg rent",
    align: "right",
    render: (r) => (r.avgRent == null ? "—" : formatGBP(r.avgRent)),
  },
];

interface LiveBook {
  totalProperties: number;
  totalRentRoll: number;
  unattributed: number;
  accounts: string[];
  byAgent: Record<string, { names: string[]; properties: number; rentRoll: number; activeTenancies: number }>;
}

export default function PortfolioTab({ month, seed }: { month: string; seed: SeedData }) {
  // The managed book, live from PayProp across both agencies. Gathered in the
  // background, so poll until it lands rather than blocking the tab.
  const [live, setLive] = useState<LiveBook | null>(null);
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const ask = () => {
      fetch("/api/admin/payprop-live", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { portfolio?: LiveBook | null }) => {
          if (cancelled) return;
          if (d.portfolio) setLive(d.portfolio);
          else if (tries++ < 40) setTimeout(ask, 5000);
        })
        .catch(() => {});
    };
    ask();
    return () => {
      cancelled = true;
    };
  }, []);

  const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
  const agents = live
    ? Object.entries(live.byAgent)
        .map(([, b]) => b)
        .sort((a, b) => b.properties - a.properties)
    : [];

  const p = seed.portfolio;
  const o = p.overview;
  const isSnapshotMonth = month === "2026-07";
  const rows = [...p.byPartner, p.totals];

  return (
    <div className="space-y-6">
      {/* Source banner */}
      {live ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
          <span className="font-semibold">Live from PayProp</span> —{" "}
          {live.totalProperties.toLocaleString("en-GB")} managed properties across{" "}
          {live.accounts.length === 2 ? "both agencies" : live.accounts.join(", ")}, worth{" "}
          <span className="font-semibold">{gbp(live.totalRentRoll)}</span> a month.
        </div>
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <span className="font-semibold">Fetching the live book from PayProp…</span>{" "}
          Showing the June 2026 portfolio report until it lands.
        </div>
      )}

      {live ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Managed book — live</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Managed properties
              </div>
              <div className="stat-value mt-1 text-[26px]">{live.totalProperties}</div>
            </div>
            <div className="card p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Rent under management
              </div>
              <div className="stat-value mt-1 text-[26px]">{gbp(live.totalRentRoll)}</div>
              <div className="mt-0.5 text-[11px] text-muted">per month</div>
            </div>
            <div className="card p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Partners with a book
              </div>
              <div className="stat-value mt-1 text-[26px]">{agents.length}</div>
            </div>
            <div className="card p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Unattributed
              </div>
              <div className="stat-value mt-1 text-[26px]">{live.unattributed}</div>
              <div className="mt-0.5 text-[11px] text-muted">
                On TLE / Admin / blank in PayProp
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h3 className="text-[13px] font-semibold">By responsible agent</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="pb-2 font-semibold">Agent</th>
                    <th className="pb-2 text-right font-semibold">Properties</th>
                    <th className="pb-2 text-right font-semibold">Tenancies</th>
                    <th className="pb-2 text-right font-semibold">Rent / month</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.names.join("|")} className="border-t border-line">
                      <td className="py-2">{a.names.join(" / ")}</td>
                      <td className="py-2 text-right tnum">{a.properties}</td>
                      <td className="py-2 text-right tnum">{a.activeTenancies}</td>
                      <td className="py-2 text-right tnum">{gbp(a.rentRoll)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] text-muted">
              Grouped on PayProp&rsquo;s own <code>responsible_agent</code> field.
              Spelling variants of one person are merged; anything that
              can&rsquo;t be resolved to a single partner is left unattributed
              rather than guessed at.
            </p>
          </div>
        </section>
      ) : null}

      {!isSnapshotMonth ? (
        <div className="rounded-2xl border border-line bg-card px-4 py-3 text-[13px] text-muted">
          Snapshot data covers July 2026 — figures below are from the 11 Jul
          2026 capture, not {monthLabel(month)}.
        </div>
      ) : null}

      {/* Overview */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Portfolio overview</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total properties"
            stat={o.total}
            big
            sub={`E&W ${o.eAndWTotal.value ?? "—"} · Glasgow ${o.glasgowTotal.value ?? "—"}`}
          />
          <StatCard
            label="Managed"
            stat={o.totalManaged}
            big
            sub={`E&W ${o.eAndWManaged.value ?? "—"} · Glasgow ${o.glasgowManaged.value ?? "—"}`}
          />
          <StatCard
            label="Let only"
            stat={o.eAndWLetOnly}
            sub="All E&W — Glasgow has 0 let-only"
          />
          <StatCard
            label="Monthly rent roll"
            stat={o.rentRollTotal}
            big
            sub={`E&W ${o.rentRollEAndW.display ?? "—"} · Glasgow ${o.rentRollGlasgow.display ?? "—"}`}
          />
        </div>
      </section>

      {/* Rent protection */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Managed — rent protection</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="No protection" stat={o.noProtection} />
          <StatCard label="With RLP" stat={o.withRlp} />
          <StatCard label="With LEC" stat={o.withLec} />
          <StatCard label="Protected %" stat={o.protectedPct} sub="of managed portfolio" />
        </div>
      </section>

      {/* Rents + health */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Rents &amp; portfolio health</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Avg rent — E&W" stat={o.avgRentEAndW} />
          <StatCard label="Avg rent — Glasgow" stat={o.avgRentGlasgow} />
          <StatCard label="Vacant" stat={o.vacant} />
          <StatCard label="Renewals due" stat={o.renewals} />
          <StatCard label="In arrears" stat={o.arrears} sub="See Arrears tab (admin only)" />
        </div>
      </section>

      {/* By partner */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          Portfolio by partner — June 2026 ({p.byPartner.length} partners)
        </h2>
        <DataTable columns={COLUMNS} rows={rows} compact />
        <p className="text-xs text-muted">{p.source}</p>
      </section>
    </div>
  );
}
