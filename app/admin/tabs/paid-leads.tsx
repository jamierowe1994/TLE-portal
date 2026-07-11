"use client";

// Admin tab: Paid leads & pro licence (GoHighLevel — no API access yet).
// All figures are July MTD snapshot values from Susan's Base44 dashboard.

import StatCard from "@/components/StatCard";
import FunnelBar from "@/components/charts/FunnelBar";
import { SEED } from "@/lib/seed-data";
import { monthLabel } from "@/lib/format";

export default function PaidLeadsTab({ month }: { month: string }) {
  const pl = SEED.paidLeads;
  const isSnapshotMonth = month === "2026-07";

  return (
    <div className="space-y-6">
      {/* Source banner */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
        <span className="font-semibold">Source: Go High Level</span> — API
        access pending, snapshot figures (captured 11 Jul 2026).
      </div>

      {!isSnapshotMonth ? (
        <div className="rounded-2xl border border-line bg-card px-4 py-3 text-[13px] text-muted">
          Snapshot data covers July 2026 — figures below are from the 11 Jul
          2026 capture, not {monthLabel(month)}.
        </div>
      ) : null}

      {/* July MTD cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Leads generated (MTD)" stat={pl.leadsGenerated} big />
        <StatCard label="Referred to agents" stat={pl.referredToAgents} />
        <StatCard label="MAs booked" stat={pl.masBooked} />
        <StatCard
          label="Lead → referral"
          stat={pl.leadToReferralPct}
          sub="3 of 180 leads referred"
        />
        <StatCard
          label="Lead → MA"
          stat={pl.leadToMaPct}
          sub="2 MAs from 3 referred leads"
        />
        <StatCard
          label="Pro licence income (MTD)"
          stat={pl.proLicenceIncome}
          sub="15 partners × £100+VAT / month"
        />
      </div>

      {/* Lead funnel */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold">Paid lead funnel — July MTD</h2>
        <p className="mt-0.5 text-xs text-muted">
          180 leads → 3 referred to agents → 2 market appraisals booked
        </p>
        <div className="mt-4">
          <FunnelBar stages={pl.funnel} />
        </div>
      </section>

      {/* Licence economics */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold">Licence economics</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Joining fee
            </div>
            <div className="stat-value mt-1 text-[26px]">£1,000+VAT</div>
            <div className="mt-1 text-xs text-muted">One-off, per partner</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Pro licence
            </div>
            <div className="stat-value mt-1 text-[26px]">£100+VAT</div>
            <div className="mt-1 text-xs text-muted">Per partner, per month</div>
          </div>
          <StatCard
            label="YTD joining fees"
            stat={pl.ytdJoiningFees}
            sub="Joining fees received Jan–Jun 2026"
          />
        </div>
        <p className="mt-4 text-xs text-muted">{pl.note}</p>
      </section>
    </div>
  );
}
