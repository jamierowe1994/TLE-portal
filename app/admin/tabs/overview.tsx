"use client";

// Admin · Overview tab — mirrors the Base44 "KPI Overview" tab, all figures
// from SEED (snapshot, 11 Jul 2026) rendered through StatCard/SourceBadge.

import StatCard from "@/components/StatCard";
import FunnelBar from "@/components/charts/FunnelBar";
import Donut from "@/components/charts/Donut";
import Bars from "@/components/charts/Bars";
import { SEED } from "@/lib/seed-data";
import { monthLabel } from "@/lib/format";

function SectionTitle({
  children,
  source,
}: {
  children: React.ReactNode;
  source?: string;
}) {
  return (
    <div className="mb-3 mt-8 first:mt-0">
      <h2 className="text-sm font-semibold uppercase tracking-wide">
        {children}
      </h2>
      {source ? (
        <p className="mt-0.5 text-[11px] text-muted">Source: {source}</p>
      ) : null}
    </div>
  );
}

export default function Overview({ month }: { month: string }) {
  const funnelStat = SEED.businessFunnel;

  const funnelStages = [
    { label: "Market Appraisals", value: funnelStat.marketAppraisals.value ?? 0 },
    { label: "Listings", value: funnelStat.listings.value ?? 0 },
    { label: "Viewings", value: funnelStat.viewings.value ?? 0 },
    { label: "Applications", value: funnelStat.applications.value ?? 0 },
    { label: "Move-ins", value: funnelStat.moveIns.value ?? 0 },
  ];

  // Jan–Jun actual GCI reconstructed from the income table. No 2026 budget
  // series was captured from the source dashboard — actual only, with a note.
  const gciRow = SEED.income.monthlyTable.find(
    (r) => r.metric === "Combined GCI (exc VAT)"
  );
  const gciSeries = gciRow
    ? [gciRow.jan, gciRow.feb, gciRow.mar, gciRow.apr, gciRow.may, gciRow.jun]
    : [];

  return (
    <div>
      {month !== "2026-07" ? (
        <p className="mb-4 rounded-xl border border-line bg-card px-4 py-2.5 text-xs text-muted">
          Snapshot figures below are from the 11 Jul 2026 dashboard capture
          (Jun YTD / July MTD cuts) — a {monthLabel(month)} cut is not
          available in the snapshot.
        </p>
      ) : null}

      <SectionTitle source="REX KPI reports · Lettings Support - Move In Report · PayProp fee reports">
        Headline — {SEED.headline.label} (last updated {SEED.headline.lastUpdated})
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Jun YTD MAs" stat={SEED.headline.mas} />
        <StatCard label="Jun YTD Listings" stat={SEED.headline.listings} />
        <StatCard label="Jun YTD Applications" stat={SEED.headline.applications} />
        <StatCard label="Jun YTD Move-ins" stat={SEED.headline.moveIns} />
        <StatCard label="Jun YTD GCI exc VAT" stat={SEED.headline.gciExcVat} />
        <StatCard label="Jun YTD Total Income" stat={SEED.headline.totalIncome} />
        <StatCard label="Jun YTD Pipeline" stat={SEED.headline.pipeline} />
      </div>

      <SectionTitle source={SEED.sources.businessFunnel}>
        Sales Funnel — July MTD
      </SectionTitle>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="card p-5">
          <FunnelBar stages={funnelStages} />
        </div>
        <div className="grid content-start gap-3">
          <StatCard label="Live Listings" stat={funnelStat.liveListings ?? { value: null, source: "snapshot" }} />
          <StatCard label="Forward Pipeline" stat={funnelStat.pipeline} />
          <StatCard label="GCI (est · exc VAT)" stat={funnelStat.gci ?? { value: null, source: "snapshot" }} />
        </div>
      </div>

      <SectionTitle source={SEED.sources.conversions}>
        Conversion Rates — July MTD
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="MA → Listing" stat={SEED.conversions.maToListing} />
        <StatCard label="Listing → Move-in" stat={SEED.conversions.listingToMoveIn} />
        <StatCard label="RLP Conversion" stat={SEED.conversions.rlpConversion} />
        <StatCard label="GCI per Move-in" stat={SEED.conversions.gciPerMoveIn} />
        <StatCard label="GCI per Agent" stat={SEED.conversions.gciPerAgent} />
      </div>

      <SectionTitle source={SEED.sources.headcount}>
        Agent Headcount — July 2026
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Active Agents" stat={SEED.headcount.activeAgents} sub="Managing portfolio" />
        <StatCard label="TLE" stat={SEED.headcount.tle} sub="Full partner" />
        <StatCard label="TLE Dual" stat={SEED.headcount.tleDual} sub="Dual brand" />
        <StatCard label="Lettings Lite" stat={SEED.headcount.lettingsLite} sub="Lite service" />
        <StatCard label="Starting Soon" stat={SEED.headcount.startingSoon} sub="Signed, building pipeline" />
        <StatCard label="Starters YTD" stat={SEED.headcount.startersYtd} sub="TLE / TLE Dual" />
        <StatCard label="Leavers YTD" stat={SEED.headcount.leaversYtd} sub="TLE / TLE Dual" />
        <StatCard label="Variance YTD" stat={SEED.headcount.varianceYtd} sub="Net change" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <SectionTitle source={SEED.sources.masByPartnerType}>
            MAs by Partner Type — July MTD
          </SectionTitle>
          <div className="card p-5">
            <Donut
              segments={[
                { label: "TLE Partners", value: SEED.masByPartnerType.tle.value ?? 0, color: "#E31F36" },
                { label: "TLE Dual", value: SEED.masByPartnerType.tleDual.value ?? 0, color: "#101014" },
                { label: "Lettings Lite", value: SEED.masByPartnerType.lettingsLite.value ?? 0, color: "#6B6B76" },
              ]}
              centerLabel={`${SEED.masByPartnerType.total.value ?? "—"} MAs`}
            />
          </div>
        </div>
        <div>
          <SectionTitle source={SEED.sources.yoyGrowth}>
            Year on Year Growth
          </SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SEED.yoyGrowth.map((entry) => (
              <StatCard
                key={entry.label}
                label={entry.label}
                stat={entry.stat}
                sub={entry.stat.note?.split("· Source: ")[1]}
              />
            ))}
          </div>
        </div>
      </div>

      <SectionTitle source={SEED.sources.income}>
        Monthly GCI — Jan–Jun 2026 actuals
      </SectionTitle>
      <div className="card p-5">
        <Bars
          labels={["Jan", "Feb", "Mar", "Apr", "May", "Jun"]}
          series={[{ name: "Actual GCI (exc VAT)", color: "#E31F36", values: gciSeries }]}
          format={(n) => `£${Math.round(n / 1000)}k`}
          height={240}
        />
        <p className="mt-3 text-[11px] text-muted">
          The 2026 budget series was not captured from the source dashboard —
          actual combined GCI only (E&W + Glasgow · exc VAT · snapshot 11 Jul
          2026). Budget bars will appear once the 2026 Budget Report figures
          are keyed in.
        </p>
      </div>

      <SectionTitle source="Agent Headcount report · REX KPI reports">
        Partner Productivity & Ramp Time — July
      </SectionTitle>
      <div className="card p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="New Starters" stat={SEED.partnerRamp.newStarters} />
          <StatCard label="MA in Months 1–2" stat={SEED.partnerRamp.maInMonths1To2} />
          <StatCard label="Listing in Months 1–2" stat={SEED.partnerRamp.listingInMonths1To2} />
          <StatCard label="Move-in within 60 Days" stat={SEED.partnerRamp.moveInWithin60Days} />
        </div>
        <p className="mt-3 text-xs text-muted">{SEED.partnerRamp.note}</p>
      </div>
    </div>
  );
}
