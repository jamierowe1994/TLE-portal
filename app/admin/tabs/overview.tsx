"use client";

// Admin · Overview — a CUSTOMISABLE dashboard. Each section is a titled block
// Susan can drag by its title, resize (S/M/L/XL), and (where it makes sense)
// switch between cards / bar / pie / line / funnel. Her layout persists per
// browser. Figures come from GET /api/admin/overview (admin-gated), merging
// manual overrides into the snapshot via the live → manual → snapshot chain.

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import StatCard from "@/components/StatCard";
import FunnelBar from "@/components/charts/FunnelBar";
import Donut from "@/components/charts/Donut";
import Bars from "@/components/charts/Bars";
import Line from "@/components/charts/Line";
import CustomizableGrid, { type DashBlock, type ViewType } from "@/components/CustomizableGrid";
import type { SeedData } from "@/lib/seed-data";
import type { StatValue } from "@/lib/types";
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
  gciByMonth: { labels: string[]; actual: (number | null)[]; budget: null; budgetNote: string };
  sources: SeedData["sources"];
}

/* ------------------------------ render helpers ------------------------------ */

function Titled({ title, source, children }: { title: string; source?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide">{title}</h2>
        {source ? <p className="mt-0.5 text-[11px] text-muted">Source: {source}</p> : null}
      </div>
      {children}
    </div>
  );
}

function ChartCard({ children }: { children: ReactNode }) {
  return <div className="card p-5">{children}</div>;
}

const num = (s: StatValue) => s.value ?? 0;

/* ---------------------------------- tab ---------------------------------- */

export default function Overview({ month }: { month: string }) {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/overview?month=${encodeURIComponent(month)}`, { cache: "no-store" });
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

  const blocks = useMemo<DashBlock[]>(() => {
    if (!data) return [];
    const d = data;

    const funnelStages = [
      { label: "Market Appraisals", value: num(d.funnel.marketAppraisals) },
      { label: "Listings", value: num(d.funnel.listings) },
      { label: "Viewings", value: num(d.funnel.viewings) },
      { label: "Applications", value: num(d.funnel.applications) },
      { label: "Move-ins", value: num(d.funnel.moveIns) },
    ];

    const headcountItems = [
      { label: "Active Agents", stat: d.headcount.activeAgents, sub: "Managing portfolio" },
      { label: "TLE", stat: d.headcount.tle, sub: "Full partner" },
      { label: "TLE Dual", stat: d.headcount.tleDual, sub: "Dual brand" },
      { label: "Lettings Lite", stat: d.headcount.lettingsLite, sub: "Lite service" },
      { label: "Starting Soon", stat: d.headcount.startingSoon, sub: "Building pipeline" },
      { label: "Starters YTD", stat: d.headcount.startersYtd, sub: "TLE / Dual" },
      { label: "Leavers YTD", stat: d.headcount.leaversYtd, sub: "TLE / Dual" },
      { label: "Variance YTD", stat: d.headcount.varianceYtd, sub: "Net change" },
    ];

    const masSegments = [
      { label: "TLE Partners", value: num(d.masByPartnerType.tle), color: "#e31f36" },
      { label: "TLE Dual", value: num(d.masByPartnerType.tleDual), color: "#111827" },
      { label: "Lettings Lite", value: num(d.masByPartnerType.lettingsLite), color: "#9ca3af" },
    ];

    return [
      {
        id: "headline",
        title: `Headline — ${d.headline.label}`,
        defaultSpan: 4,
        views: ["cards"] as const,
        render: () => (
          <Titled
            title={`Headline — ${d.headline.label}`}
            source="REX KPI reports · Move-in report · PayProp fee reports"
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              <StatCard size="sm" label="Jun YTD MAs" stat={d.headline.mas} />
              <StatCard size="sm" label="Jun YTD Listings" stat={d.headline.listings} />
              <StatCard size="sm" label="Jun YTD Applications" stat={d.headline.applications} />
              <StatCard size="sm" label="Jun YTD Move-ins" stat={d.headline.moveIns} />
              <StatCard size="sm" label="Jun YTD GCI exc VAT" stat={d.headline.gciExcVat} />
              <StatCard size="sm" label="Jun YTD Total Income" stat={d.headline.totalIncome} />
              <StatCard size="sm" label="Jun YTD Pipeline" stat={d.headline.pipeline} />
            </div>
          </Titled>
        ),
      },
      {
        id: "funnel",
        title: "Sales Funnel",
        defaultSpan: 2,
        views: ["funnel", "bar"] as const,
        render: (v: ViewType) => (
          <Titled title="Sales Funnel — July MTD" source={d.sources.businessFunnel}>
            <ChartCard>
              {v === "bar" ? (
                <Bars
                  labels={funnelStages.map((s) => s.label)}
                  series={[{ name: "Count", color: "#e31f36", values: funnelStages.map((s) => s.value) }]}
                  height={240}
                />
              ) : (
                <FunnelBar stages={funnelStages} showSteps={false} barHeight={40} />
              )}
            </ChartCard>
          </Titled>
        ),
      },
      {
        id: "funnelStats",
        title: "Funnel Detail",
        defaultSpan: 2,
        views: ["cards"] as const,
        render: () => (
          <Titled title="Funnel Detail — July MTD">
            <div className="grid grid-cols-2 gap-3">
              <StatCard size="sm" label="Move-ins" stat={d.funnel.moveIns} />
              <StatCard size="sm" label="Live Listings" stat={d.funnel.liveListings ?? { value: null, source: "snapshot" }} />
              <StatCard size="sm" label="Forward Pipeline" stat={d.funnel.pipeline} />
              <StatCard size="sm" label="GCI (est · exc VAT)" stat={d.funnel.gci ?? { value: null, source: "snapshot" }} />
            </div>
          </Titled>
        ),
      },
      {
        id: "conversions",
        title: "Conversion Rates",
        defaultSpan: 4,
        views: ["cards"] as const,
        render: () => (
          <Titled title="Conversion Rates — July MTD" source={d.sources.conversions}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <StatCard size="sm" label="MA → Listing" stat={d.conversions.maToListing} />
              <StatCard size="sm" label="Listing → Move-in" stat={d.conversions.listingToMoveIn} />
              <StatCard size="sm" label="RLP Conversion" stat={d.conversions.rlpConversion} />
              <StatCard size="sm" label="GCI per Move-in" stat={d.conversions.gciPerMoveIn} />
              <StatCard size="sm" label="GCI per Agent" stat={d.conversions.gciPerAgent} />
            </div>
          </Titled>
        ),
      },
      {
        id: "headcount",
        title: "Agent Headcount",
        defaultSpan: 4,
        views: ["cards", "bar"] as const,
        render: (v: ViewType) => (
          <Titled title="Agent Headcount — July 2026" source={d.sources.headcount}>
            {v === "bar" ? (
              <ChartCard>
                <Bars
                  labels={headcountItems.map((i) => i.label)}
                  series={[{ name: "Agents", color: "#e31f36", values: headcountItems.map((i) => num(i.stat)) }]}
                  height={240}
                />
              </ChartCard>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
                {headcountItems.map((i) => (
                  <StatCard key={i.label} size="sm" label={i.label} stat={i.stat} sub={i.sub} />
                ))}
              </div>
            )}
          </Titled>
        ),
      },
      {
        id: "masByType",
        title: "MAs by Partner Type",
        defaultSpan: 2,
        views: ["pie", "bar", "cards"] as const,
        render: (v: ViewType) => (
          <Titled title="MAs by Partner Type — July MTD" source={d.sources.masByPartnerType}>
            {v === "cards" ? (
              <div className="grid grid-cols-2 gap-3">
                <StatCard size="sm" label="Total MAs" stat={d.masByPartnerType.total} />
                <StatCard size="sm" label="TLE Partners" stat={d.masByPartnerType.tle} />
                <StatCard size="sm" label="TLE Dual" stat={d.masByPartnerType.tleDual} />
                <StatCard size="sm" label="Lettings Lite" stat={d.masByPartnerType.lettingsLite} />
              </div>
            ) : v === "bar" ? (
              <ChartCard>
                <Bars
                  labels={masSegments.map((s) => s.label)}
                  series={[{ name: "MAs", color: "#e31f36", values: masSegments.map((s) => s.value) }]}
                  height={220}
                />
              </ChartCard>
            ) : (
              <ChartCard>
                <Donut segments={masSegments} centerLabel={`${d.masByPartnerType.total.value ?? "—"} MAs`} />
              </ChartCard>
            )}
          </Titled>
        ),
      },
      {
        id: "yoy",
        title: "Year on Year Growth",
        defaultSpan: 2,
        views: ["cards"] as const,
        render: () => (
          <Titled title="Year on Year Growth" source={d.sources.yoyGrowth}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {d.yoyGrowth.map((entry) => (
                <StatCard key={entry.label} size="sm" label={entry.label} stat={entry.stat} sub={entry.stat.note?.split("· Source: ")[1]} />
              ))}
            </div>
          </Titled>
        ),
      },
      {
        id: "gciByMonth",
        title: "Monthly GCI",
        defaultSpan: 4,
        views: ["bar", "line"] as const,
        render: (v: ViewType) => (
          <Titled title="Monthly GCI — Jan–Jun 2026 actuals" source={d.sources.income}>
            <ChartCard>
              {v === "line" ? (
                <Line
                  labels={d.gciByMonth.labels}
                  series={[{ name: "Actual GCI (exc VAT)", color: "#e31f36", values: d.gciByMonth.actual }]}
                  format={(n) => `£${Math.round(n / 1000)}k`}
                  height={240}
                />
              ) : (
                <Bars
                  labels={d.gciByMonth.labels}
                  series={[{ name: "Actual GCI (exc VAT)", color: "#e31f36", values: d.gciByMonth.actual }]}
                  format={(n) => `£${Math.round(n / 1000)}k`}
                  height={240}
                />
              )}
              <p className="mt-3 text-[11px] text-muted">{d.gciByMonth.budgetNote}</p>
            </ChartCard>
          </Titled>
        ),
      },
      {
        id: "ramp",
        title: "Partner Productivity & Ramp",
        defaultSpan: 4,
        views: ["cards"] as const,
        render: () => (
          <Titled title="Partner Productivity & Ramp Time — July" source="Agent Headcount report · REX KPI reports">
            <div className="card p-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard size="sm" label="New Starters" stat={d.partnerRamp.newStarters} />
                <StatCard size="sm" label="MA in Months 1–2" stat={d.partnerRamp.maInMonths1To2} />
                <StatCard size="sm" label="Listing in Months 1–2" stat={d.partnerRamp.listingInMonths1To2} />
                <StatCard size="sm" label="Move-in within 60 Days" stat={d.partnerRamp.moveInWithin60Days} />
              </div>
              <p className="mt-3 text-xs text-muted">{d.partnerRamp.note}</p>
            </div>
          </Titled>
        ),
      },
    ];
  }, [data]);

  if (error) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">{error}</p>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted">Loading overview…</p>;
  }

  return (
    <div>
      {month !== "2026-07" ? (
        <p className="mb-4 rounded-xl border border-line bg-card px-4 py-2.5 text-xs text-muted">
          Snapshot figures below are from the 11 Jul 2026 dashboard capture (Jun YTD / July MTD cuts) — a{" "}
          {monthLabel(month)} cut is not available in the snapshot.
        </p>
      ) : null}
      <CustomizableGrid blocks={blocks} storageKey="tle_admin_overview_v1" />
    </div>
  );
}
