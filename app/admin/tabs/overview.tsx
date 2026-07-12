"use client";

// Admin · Overview tab — mirrors the Base44 "KPI Overview" tab. Figures come
// from GET /api/admin/overview (admin-gated), which merges admin manual
// overrides (actuals-store) into the snapshot through the live → manual →
// snapshot resolveStat chain — so a figure keyed in on another tab (e.g. the
// July move-in count on Move-ins) shows here with the same MANUAL badge.

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import FunnelBar from "@/components/charts/FunnelBar";
import Donut from "@/components/charts/Donut";
import Bars from "@/components/charts/Bars";
import type { SeedData } from "@/lib/seed-data"; // type-only — erased at build
import { monthLabel } from "@/lib/format";

interface OverviewPayload {
  month: string;
  headline: SeedData["headline"];
  headcount: SeedData["headcount"];
  partnerRamp: SeedData["partnerRamp"];
  funnel: SeedData["businessFunnel"];
  conversions: SeedData["conversions"];
  masByPartnerType: SeedData["masByPartnerType"];
  yoyGrowth: SeedData["yoyGrowth"];
  gciByMonth: {
    labels: string[];
    actual: (number | null)[];
    budget: null;
    budgetNote: string;
  };
  sources: SeedData["sources"];
}

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
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/overview?month=${encodeURIComponent(month)}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`Overview fetch failed (${res.status})`);
        const payload = (await res.json()) as OverviewPayload;
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setError("Couldn't load the business overview.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month]);

  if (error) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
        {error}
      </p>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted">Loading overview…</p>;
  }

  const funnelStat = data.funnel;

  const funnelStages = [
    { label: "Market Appraisals", value: funnelStat.marketAppraisals.value ?? 0 },
    { label: "Listings", value: funnelStat.listings.value ?? 0 },
    { label: "Viewings", value: funnelStat.viewings.value ?? 0 },
    { label: "Applications", value: funnelStat.applications.value ?? 0 },
    { label: "Move-ins", value: funnelStat.moveIns.value ?? 0 },
  ];

  // Jan–Jun actual GCI, assembled server-side from the income table. No 2026
  // budget series was captured from the source dashboard — actual only.
  const gciSeries = data.gciByMonth.actual;

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
        Headline — {data.headline.label} (last updated {data.headline.lastUpdated})
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard size="sm" label="Jun YTD MAs" stat={data.headline.mas} />
        <StatCard size="sm" label="Jun YTD Listings" stat={data.headline.listings} />
        <StatCard size="sm" label="Jun YTD Applications" stat={data.headline.applications} />
        <StatCard size="sm" label="Jun YTD Move-ins" stat={data.headline.moveIns} />
        <StatCard size="sm" label="Jun YTD GCI exc VAT" stat={data.headline.gciExcVat} />
        <StatCard size="sm" label="Jun YTD Total Income" stat={data.headline.totalIncome} />
        <StatCard size="sm" label="Jun YTD Pipeline" stat={data.headline.pipeline} />
      </div>

      <SectionTitle source={data.sources.businessFunnel}>
        Sales Funnel — July MTD
      </SectionTitle>
      <div className="card p-5 sm:p-6">
        <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="mx-auto w-full" style={{ maxWidth: 640 }}>
            <FunnelBar stages={funnelStages} showSteps={false} barHeight={44} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatCard size="sm" label="Move-ins" stat={funnelStat.moveIns} />
            <StatCard size="sm" label="Live Listings" stat={funnelStat.liveListings ?? { value: null, source: "snapshot" }} />
            <StatCard size="sm" label="Forward Pipeline" stat={funnelStat.pipeline} />
            <StatCard size="sm" label="GCI (est · exc VAT)" stat={funnelStat.gci ?? { value: null, source: "snapshot" }} />
          </div>
        </div>
      </div>

      <SectionTitle source={data.sources.conversions}>
        Conversion Rates — July MTD
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="MA → Listing" stat={data.conversions.maToListing} />
        <StatCard label="Listing → Move-in" stat={data.conversions.listingToMoveIn} />
        <StatCard label="RLP Conversion" stat={data.conversions.rlpConversion} />
        <StatCard label="GCI per Move-in" stat={data.conversions.gciPerMoveIn} />
        <StatCard label="GCI per Agent" stat={data.conversions.gciPerAgent} />
      </div>

      <SectionTitle source={data.sources.headcount}>
        Agent Headcount — July 2026
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Active Agents" stat={data.headcount.activeAgents} sub="Managing portfolio" />
        <StatCard label="TLE" stat={data.headcount.tle} sub="Full partner" />
        <StatCard label="TLE Dual" stat={data.headcount.tleDual} sub="Dual brand" />
        <StatCard label="Lettings Lite" stat={data.headcount.lettingsLite} sub="Lite service" />
        <StatCard label="Starting Soon" stat={data.headcount.startingSoon} sub="Signed, building pipeline" />
        <StatCard label="Starters YTD" stat={data.headcount.startersYtd} sub="TLE / TLE Dual" />
        <StatCard label="Leavers YTD" stat={data.headcount.leaversYtd} sub="TLE / TLE Dual" />
        <StatCard label="Variance YTD" stat={data.headcount.varianceYtd} sub="Net change" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <SectionTitle source={data.sources.masByPartnerType}>
            MAs by Partner Type — July MTD
          </SectionTitle>
          <div className="card p-5">
            <Donut
              segments={[
                { label: "TLE Partners", value: data.masByPartnerType.tle.value ?? 0, color: "#E31F36" },
                { label: "TLE Dual", value: data.masByPartnerType.tleDual.value ?? 0, color: "#101014" },
                { label: "Lettings Lite", value: data.masByPartnerType.lettingsLite.value ?? 0, color: "#6B6B76" },
              ]}
              centerLabel={`${data.masByPartnerType.total.value ?? "—"} MAs`}
            />
          </div>
        </div>
        <div>
          <SectionTitle source={data.sources.yoyGrowth}>
            Year on Year Growth
          </SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.yoyGrowth.map((entry) => (
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

      <SectionTitle source={data.sources.income}>
        Monthly GCI — Jan–Jun 2026 actuals
      </SectionTitle>
      <div className="card p-5">
        <Bars
          labels={data.gciByMonth.labels}
          series={[{ name: "Actual GCI (exc VAT)", color: "#E31F36", values: gciSeries }]}
          format={(n) => `£${Math.round(n / 1000)}k`}
          height={240}
        />
        <p className="mt-3 text-[11px] text-muted">{data.gciByMonth.budgetNote}</p>
      </div>

      <SectionTitle source="Agent Headcount report · REX KPI reports">
        Partner Productivity & Ramp Time — July
      </SectionTitle>
      <div className="card p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="New Starters" stat={data.partnerRamp.newStarters} />
          <StatCard label="MA in Months 1–2" stat={data.partnerRamp.maInMonths1To2} />
          <StatCard label="Listing in Months 1–2" stat={data.partnerRamp.listingInMonths1To2} />
          <StatCard label="Move-in within 60 Days" stat={data.partnerRamp.moveInWithin60Days} />
        </div>
        <p className="mt-3 text-xs text-muted">{data.partnerRamp.note}</p>
      </div>
    </div>
  );
}
