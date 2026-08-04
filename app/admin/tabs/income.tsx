"use client";

// Admin tab: Income — July MTD estimates, June finals, Jan–Jun monthly income
// table, licence fee table, YoY growth chips, GCI vs total income bars.
// GCI actuals come from PayProp reports (no API access yet) — snapshot badges.

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import Donut from "@/components/charts/Donut";
import Bars from "@/components/charts/Bars";
import type { SeedData } from "@/lib/seed-data"; // type-only — erased at build
import type { IncomeMonthlyRow, LicenceFeeRow } from "@/lib/seed-types";
import { exVat, formatGBP, formatNum, monthLabel } from "@/lib/format";


/* ------------------------------ table columns ------------------------------ */

function money(v: number | null): string {
  return v == null ? "—" : formatGBP(v);
}

const HIGHLIGHT_METRICS = new Set(["Combined GCI (exc VAT)", "TOTAL INCOME"]);

const MONTHLY_COLUMNS: DataTableColumn<IncomeMonthlyRow & Record<string, unknown>>[] = [
  {
    key: "metric",
    label: "Metric",
    render: (r) => (
      <span className={HIGHLIGHT_METRICS.has(r.metric) ? "font-semibold" : undefined}>
        {r.metric}
      </span>
    ),
  },
  { key: "jan", label: "Jan", align: "right", render: (r) => money(r.jan) },
  { key: "feb", label: "Feb", align: "right", render: (r) => money(r.feb) },
  { key: "mar", label: "Mar", align: "right", render: (r) => money(r.mar) },
  {
    key: "q1",
    label: "Q1",
    align: "right",
    render: (r) => <span className="font-semibold">{money(r.q1)}</span>,
  },
  { key: "apr", label: "Apr", align: "right", render: (r) => money(r.apr) },
  { key: "may", label: "May", align: "right", render: (r) => money(r.may) },
  { key: "jun", label: "Jun", align: "right", render: (r) => money(r.jun) },
  {
    key: "q2",
    label: "Q2",
    align: "right",
    render: (r) => <span className="font-semibold">{money(r.q2)}</span>,
  },
  {
    key: "ytd",
    label: "YTD",
    align: "right",
    render: (r) => <span className="font-semibold">{money(r.ytd)}</span>,
  },
];

const LICENCE_COLUMNS: DataTableColumn<LicenceFeeRow & Record<string, unknown>>[] = [
  {
    key: "month",
    label: "Month",
    render: (r) => (
      <span className={r.month === "YTD Total" ? "font-semibold" : undefined}>{r.month}</span>
    ),
  },
  { key: "monthlyLicence", label: "Monthly licence", align: "right", render: (r) => money(r.monthlyLicence) },
  { key: "proLicence", label: "Pro licence", align: "right", render: (r) => money(r.proLicence) },
  { key: "joiningFees", label: "Joining fees", align: "right", render: (r) => money(r.joiningFees) },
  {
    key: "total",
    label: "Total",
    align: "right",
    render: (r) => <span className="font-semibold">{money(r.total)}</span>,
  },
];

/* ------------------------------- YoY chip row ------------------------------- */

function YoyChips({ label, data }: { label: string; data: Record<string, number> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      {Object.entries(data).map(([m, v]) => (
        <span
          key={m}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tnum ${
            v >= 0
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {m} {v >= 0 ? "+" : ""}
          {formatNum(v)}%
        </span>
      ))}
    </div>
  );
}

/* --------------------------------- the tab --------------------------------- */

// £1,200 average GCI per move-in — Susan's own July-estimate formula
// (her £12,000 est = 10 move-ins × £1,200). PayProp will replace this
// with actuals when connected.
const AVG_GCI_PER_MOVE_IN = 1200;

interface LiveIncome {
  agencyIncome: number;
  combinedGci: number;
  paidToBeneficiaries: number;
  ownerPayments: number;
  byCategory: Array<{ category: string; amount: number }>;
  byAccount: Array<{ account: string; label: string; agencyIncome: number; combinedGci: number }>;
  paymentCount: number;
  agentsEarning: number;
}
interface LiveMoveIns {
  count: number;
  rentAdded: number;
}

export default function IncomeTab({ month, seed }: { month: string; seed: SeedData }) {
  const inc = seed.income;

  // Live money from PayProp — gathered in the background, so poll for it.
  const [live, setLive] = useState<LiveIncome | null>(null);
  const [prev, setPrev] = useState<LiveIncome | null>(null);
  const [moveIns, setMoveIns] = useState<LiveMoveIns | null>(null);
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    setLive(null);
    setPrev(null);
    setMoveIns(null);
    const ask = () => {
      fetch(`/api/admin/payprop-live?month=${month}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: {
          income?: LiveIncome | null;
          prevIncome?: LiveIncome | null;
          moveIns?: LiveMoveIns | null;
          refreshing?: boolean;
        }) => {
          if (cancelled) return;
          if (d.income) setLive(d.income);
          if (d.prevIncome) setPrev(d.prevIncome);
          if (d.moveIns) setMoveIns(d.moveIns);
          // The previous month is a second walk and lands later than this
          // month's, so keep asking until both are in.
          if ((!d.income || !d.prevIncome) && tries++ < 40) setTimeout(ask, 5000);
        })
        .catch(() => {});
    };
    ask();
    return () => {
      cancelled = true;
    };
  }, [month]);

  const gbp = (n: number) =>
    `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

  /**
   * Live PayProp amounts arrive INCLUSIVE of VAT; every historical row on this
   * tab is seeded from the accounts spreadsheet, whose fee columns are all
   * "exc VAT". The live cards must be netted or the tab disagrees with itself
   * — which is exactly how July read ~£61.3k here against £51,068 on Susan's
   * summary: same fees, hers net, ours gross, the gap the VAT to the penny.
   */
  const netGbp = (n: number) => gbp(exVat(n));

  /** One agency's GCI, or null when it isn't there yet. */
  const accountGci = (l: LiveIncome | null, label: string) => {
    const a = l?.byAccount?.find((x) => x.label === label);
    if (!a) return null;
    return {
      value: Math.round(exVat(a.combinedGci)),
      display: netGbp(a.combinedGci),
      source: "live-payprop" as const,
      note: `${netGbp(a.agencyIncome)} exc VAT kept by the agency; the rest paid to partners.`,
    };
  };

  /**
   * The month just gone, from PayProp. Everything here is a fee figure or a
   * ratio of two of them, so it's as final as the snapshot was — but current.
   * Returns null until the walk lands, so the card falls back rather than
   * flashing a zero.
   */
  const prevMonthKey = (() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  })();
  const prevLabel = monthLabel(prevMonthKey);

  const pv = (which: "totalGci" | "tleNet" | "gciPerAgent" | "netPerAgent" | "splitPct") => {
    if (!prev) return null;
    const agents = prev.agentsEarning || 0;
    const note = `Live from PayProp — ${prevLabel} final, ${prev.paymentCount} payments.`;
    const src = "live-payprop" as const;
    switch (which) {
      case "totalGci":
        return { value: Math.round(exVat(prev.combinedGci)), display: netGbp(prev.combinedGci), source: src, note };
      case "tleNet":
        return { value: Math.round(exVat(prev.agencyIncome)), display: netGbp(prev.agencyIncome), source: src, note };
      case "gciPerAgent":
        if (!agents) return null;
        return {
          value: Math.round(exVat(prev.combinedGci) / agents),
          display: gbp(exVat(prev.combinedGci) / agents),
          source: src,
          note: `${netGbp(prev.combinedGci)} exc VAT across ${agents} earning partners.`,
        };
      case "netPerAgent":
        if (!agents) return null;
        return {
          value: Math.round(exVat(prev.agencyIncome) / agents),
          display: gbp(exVat(prev.agencyIncome) / agents),
          source: src,
          note: `${netGbp(prev.agencyIncome)} exc VAT across ${agents} earning partners.`,
        };
      case "splitPct": {
        if (!prev.combinedGci) return null;
        const pct = Math.round((prev.agencyIncome / prev.combinedGci) * 100);
        return { value: pct, display: `${pct}%`, source: src, note };
      }
    }
  };

  // Resolved once so the card and its sub-line quote the SAME split — computed
  // twice, the sub kept reading the snapshot while the stat had gone live.
  const liveSplit = pv("splitPct");
  const splitStat = liveSplit ?? inc.june.tleSplitPct;
  // The partners' cash sits next to that percentage, so it has to come off the
  // same month: prev's own beneficiary total, not June's snapshot.
  const splitPartnerNet =
    liveSplit && prev ? gbp(prev.paidToBeneficiaries) : inc.june.partnerNetIncome.display ?? "";

  const isSnapshotMonth = month === "2026-07";

  // Live estimate input: this month's completed move-ins from Propoly.
  const [liveMoveIns, setLiveMoveIns] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/live-business?month=${encodeURIComponent(month)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const mi = (j as { propoly?: { moveInsThisMonth?: number } | null }).propoly
          ?.moveInsThisMonth;
        if (!cancelled && typeof mi === "number") setLiveMoveIns(mi);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [month]);

  const liveGciEst =
    liveMoveIns != null
      ? {
          value: liveMoveIns * AVG_GCI_PER_MOVE_IN,
          display: formatGBP(liveMoveIns * AVG_GCI_PER_MOVE_IN),
          source: "live-propoly" as const,
          note: `Estimate from live data — ${liveMoveIns} completed move-ins this month (live from Propoly) × £1,200 avg GCI, Susan's own estimating formula. PayProp actuals replace this when connected.`,
          asOf: new Date().toISOString().slice(0, 10),
        }
      : null;

  // GCI vs total income bars, Jan–Jun (from the monthly income table rows)
  const gciRow = inc.monthlyTable.find((r) => r.metric === "Combined GCI (exc VAT)");
  const totalRow = inc.monthlyTable.find((r) => r.metric === "TOTAL INCOME");
  const monthKeys = ["jan", "feb", "mar", "apr", "may", "jun"] as const;
  const barLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const barSeries = [
    {
      name: "Combined GCI (exc VAT)",
      color: "#E31F36",
      values: monthKeys.map((k) => gciRow?.[k] ?? null),
    },
    {
      name: "Total income",
      color: "#101014",
      values: monthKeys.map((k) => totalRow?.[k] ?? null),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Source banner */}
      {live ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
          <span className="font-semibold">Live from PayProp</span> — {monthLabel(month)}{" "}
          agency income across {live.paymentCount.toLocaleString("en-GB")} payments.
          Derived from the all-payments report (the agency&rsquo;s own share), since
          the dedicated agency-income report needs a scope we weren&rsquo;t granted.
        </div>
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <span className="font-semibold">Fetching live figures from PayProp…</span>{" "}
          Showing the 11 Jul 2026 snapshot until they land.
        </div>
      )}

      {live ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">{monthLabel(month)} — live from PayProp</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Agency income (GCI)"
              stat={{ value: Math.round(live.agencyIncome), display: gbp(live.agencyIncome), source: "live-payprop", note: `TLE's own share of the fees, across ${live.paymentCount} payments.` }}
              big
            />
            <StatCard
              label="Paid to partners"
              stat={{ value: Math.round(live.paidToBeneficiaries), display: gbp(live.paidToBeneficiaries), source: "live-payprop", note: "The partners' share of the same fees." }}
              big
            />
            <StatCard
              label="Rent to landlords"
              stat={{ value: Math.round(live.ownerPayments), display: gbp(live.ownerPayments), source: "live-payprop", note: "Rent passed through to owners — volume, not income." }}
              big
              sub="Passed through, not income"
            />
            <StatCard
              label="Move-ins"
              stat={
                moveIns
                  ? { value: moveIns.count, source: "live-payprop", note: "Rent schedules starting this month." }
                  : { value: null, source: "live-payprop" }
              }
              big
              sub={moveIns ? `${gbp(moveIns.rentAdded)} rent added` : "Tenancies starting"}
            />
          </div>

          <div className="card p-5">
            <h3 className="text-[13px] font-semibold">Agency income by fee type</h3>
            <div className="mt-3 space-y-1.5">
              {live.byCategory.map((c) => (
                <div key={c.category} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                    {c.category}
                  </span>
                  <span className="h-1.5 rounded-full bg-accent/70"
                    style={{ width: `${Math.max(4, (c.amount / live.agencyIncome) * 160)}px` }} />
                  <span className="shrink-0 text-[12.5px] font-semibold text-ink tnum">
                    {gbp(c.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {!isSnapshotMonth ? (
        <div className="rounded-2xl border border-line bg-card px-4 py-3 text-[13px] text-muted">
          Snapshot data covers July 2026 — figures below are from the 11 Jul
          2026 capture, not {monthLabel(month)}.
        </div>
      ) : null}

      {/* July MTD estimates */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">July MTD — estimates</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label={live ? "Combined GCI" : "Combined GCI (est)"}
            stat={
              live
                ? {
                    value: Math.round(exVat(live.combinedGci)),
                    display: netGbp(live.combinedGci),
                    source: "live-payprop",
                    note: `Every fee charged this month across both agencies, exc VAT, ${live.paymentCount} payments. TLE's share plus the partners'.`,
                  }
                : liveGciEst ?? inc.julyMtd.combinedGci
            }
            sub={
              live
                ? `${netGbp(live.agencyIncome)} TLE · ${netGbp(live.paidToBeneficiaries)} partners, exc VAT`
                : liveGciEst && liveMoveIns != null
                  ? `${liveMoveIns} live move-ins × £1,200 avg`
                  : undefined
            }
            big
          />
          <StatCard label="E&W GCI" stat={accountGci(live, "E&W") ?? inc.julyMtd.eAndWGci} />
          <StatCard label="Glasgow GCI" stat={accountGci(live, "Glasgow") ?? inc.julyMtd.glasgowGci} />
          <StatCard
            label="TLE net income"
            stat={
              live
                ? { value: Math.round(live.agencyIncome), display: gbp(live.agencyIncome), source: "live-payprop", note: "Fees kept by the agency this month." }
                : inc.julyMtd.tleNetIncome
            }
          />
          <StatCard
            label="Paid to associates"
            stat={
              live
                ? { value: Math.round(live.paidToBeneficiaries), display: gbp(live.paidToBeneficiaries), source: "live-payprop", note: "Fees paid out to partners this month." }
                : inc.julyMtd.paidToAssociates
            }
          />
          <StatCard label="June final GCI" stat={inc.julyMtd.juneFinalGci} sub="Previous month, final" />
        </div>
      </section>

      {/* Split donut + June finals */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-5">
          <h2 className="text-sm font-semibold">TLE / partner split — July MTD est</h2>
          <div className="mt-4">
            <Donut
              segments={[
                { label: "TLE net", value: inc.julyMtd.tleNetIncome.value ?? 0, color: "#E31F36" },
                { label: "Associates", value: inc.julyMtd.paidToAssociates.value ?? 0, color: "#101014" },
              ]}
              centerLabel={inc.julyMtd.combinedGci.display ?? ""}
            />
          </div>
          <p className="mt-3 text-xs text-muted">{inc.julyMtd.splitNote}</p>
        </section>

        <section className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">{prevLabel} — final</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Total GCI" stat={pv("totalGci") ?? inc.june.totalGci} />
            <StatCard label="Total income" stat={inc.june.totalIncome} />
            <StatCard label="TLE net income" stat={pv("tleNet") ?? inc.june.tleNetIncome} />
            <StatCard label="GCI per agent" stat={pv("gciPerAgent") ?? inc.june.gciPerAgent} />
            <StatCard
              label="Net income per agent"
              stat={pv("netPerAgent") ?? inc.june.netIncomePerAgent}
            />
            <StatCard
              label="TLE split of E&W GCI"
              stat={splitStat}
              sub={
                splitStat.value != null
                  ? `Partners ${100 - splitStat.value}%${splitPartnerNet ? ` — ${splitPartnerNet}` : ""}`
                  : undefined
              }
            />
            <StatCard label="Monthly licence" stat={inc.june.monthlyLicence} />
            <StatCard label="Pro licence" stat={inc.june.proLicence} />
            <StatCard label="Joining fees" stat={inc.june.joiningFees} />
          </div>
        </section>
      </div>

      {/* Monthly income table */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          TLE business income — Jan–Jun 2026 (all fees exc VAT)
        </h2>
        <DataTable columns={MONTHLY_COLUMNS} rows={inc.monthlyTable} compact />
        <p className="text-xs text-muted">{inc.modelNote}</p>
      </section>

      {/* GCI vs total income bars */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold">Combined GCI vs total income — Jan–Jun 2026</h2>
        <div className="mt-4">
          <Bars labels={barLabels} series={barSeries} format={(n) => `£${formatNum(n / 1000)}k`} />
        </div>
      </section>

      {/* Licence fee table */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Licence fee income — 2026</h2>
        <DataTable columns={LICENCE_COLUMNS} rows={inc.licenceFeeTable} compact />
      </section>

      {/* YoY growth */}
      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold">Year-on-year GCI growth (gross, exc VAT)</h2>
        <YoyChips label="2024 → 2025" data={inc.yoyGrowthPct["2024to2025"]} />
        <YoyChips label="2025 → 2026" data={inc.yoyGrowthPct["2025to2026"]} />
      </section>
    </div>
  );
}
