"use client";

// Admin tab: Overview — a stat-for-stat MIRROR of Susan's Base44 dashboard
// ("KPI Overview" at tle-business-dashboard.base44.app, captured 21 Jul 2026):
// same sections, same order, same boxes, same notes. Our upgrade on top:
// tiles whose figure we can source live (REX business sums, Propoly move-ins)
// render white with a green LIVE dot; everything still on the snapshot is
// dimmed grey so what's live and what isn't is obvious at a glance.
//
// Section order (hers): headline band → Agent Headcount → Partner
// Productivity & Ramp → Business KPIs (Sales Funnel) → Conversion Rates →
// MAs by Partner Type → Monthly GCI vs Budget → Year on Year Growth.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Bars from "@/components/charts/Bars";
import type { SeedData } from "@/lib/seed-data";
import type { StatValue } from "@/lib/types";
import { formatNum } from "@/lib/format";

interface LiveBusiness {
  month: string;
  agentsCounted?: number;
  agentsTotal?: number;
  totals?: { marketAppraisals: number; onMarketListings: number; pipeline: number; managed: number; rentRoll: number };
  propoly?: {
    month: string;
    pipelineTotal: number;
    pipelineByStage: { key: string; label: string; count: number }[];
    moveInsThisMonth: number;
    generatedAt: string;
  } | null;
  generatedAt?: string;
}

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

/* --------------------------------- tiles --------------------------------- */

// The mirror's building block. Live figures pop (white card, green dot);
// snapshot figures are deliberately dimmed — James's "grey them out so you
// can see what's not live yet".
function Tile({
  label,
  stat,
  sub,
}: {
  label: string;
  stat: StatValue;
  sub?: string | null;
}) {
  const isLive = stat.source === "live-rex" || stat.source === "live-meta" || stat.source === "live-propoly";
  const isManual = stat.source === "manual";
  const value = stat.display ?? (stat.value != null ? formatNum(stat.value) : "—");
  return (
    <div
      className={`relative rounded-xl border p-3 text-center transition ${
        isLive
          ? "border-green-200 bg-white shadow-sm"
          : isManual
            ? "border-amber-200 bg-white"
            : "border-line bg-page/70"
      }`}
      title={stat.note ?? undefined}
    >
      {isLive ? (
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 text-[9px] font-semibold text-green-600">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
          LIVE
        </span>
      ) : isManual ? (
        <span className="absolute right-2 top-2 text-[9px] font-semibold text-amber-600">MANUAL</span>
      ) : null}
      <div
        className={`stat-value text-[24px] leading-tight ${
          isLive || isManual ? "text-ink" : "text-ink/60"
        }`}
      >
        {value}
      </div>
      <div className={`mt-1 text-[10px] font-semibold uppercase tracking-wide ${isLive ? "text-ink" : "text-muted"}`}>
        {label}
      </div>
      {sub ? <div className="mt-0.5 text-[10px] leading-snug text-muted">{sub}</div> : null}
    </div>
  );
}

const TILE_GRID = "grid gap-3 grid-cols-[repeat(auto-fit,minmax(140px,1fr))]";

// Seed notes read "<snapshot boilerplate> · Source: <the useful bit>" — tiles
// show just the useful bit (the full note stays in the hover tooltip).
function subNote(s: StatValue | undefined | null): string | null {
  const n = s?.note;
  if (!n) return null;
  const marker = "· Source: ";
  const i = n.indexOf(marker);
  return i >= 0 ? n.slice(i + marker.length) : n;
}

/** Section shell: bold title left, tiny SOURCE right — exactly her layout. */
function Section({
  title,
  source,
  children,
}: {
  title: string;
  source?: string;
  children: ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {source ? (
          <span className="text-[10px] uppercase tracking-wide text-muted">Source: {source}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Her period pill row. Only July is in the snapshot, so the rest sit dimmed
    until the month-by-month history arrives with the live integrations. */
function PeriodPills({ periods }: { periods: string[] }) {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {periods.map((p, i) => (
        <span
          key={p}
          title={i === 0 ? undefined : "Month-by-month history arrives with the live integrations — the snapshot holds July."}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
            i === 0 ? "bg-ink text-white" : "cursor-default bg-page text-muted/50"
          }`}
        >
          {p}
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------- tab ---------------------------------- */

export default function Overview({ month }: { month: string }) {
  void month; // the mirror is the July-2026 snapshot + live upgrades
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveBusiness | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/overview?month=2026-07`, { cache: "no-store" });
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
  }, []);

  // Live layer (REX business sums + Propoly) — upgrades matching tiles.
  const loadLive = useCallback(async (refresh = false) => {
    setLiveLoading(true);
    try {
      const res = await fetch(`/api/admin/live-business?month=2026-07${refresh ? "&refresh=1" : ""}`, {
        cache: "no-store",
      });
      const j = (await res.json()) as LiveBusiness & { configured?: boolean };
      setLive(j);
    } catch {
      /* live layer is an upgrade — the snapshot mirror still renders */
    } finally {
      setLiveLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLive();
  }, [loadLive]);

  if (error) {
    return <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted">Loading overview…</p>;
  }
  const d = data;

  // Upgrade a snapshot stat to live when the live layer carries the same figure.
  const asLive = (value: number, note: string, display?: string): StatValue => ({
    value,
    display,
    source: "live-rex",
    note,
    asOf: new Date().toISOString().slice(0, 10),
  });
  const funnelMas = live?.totals
    ? asLive(live.totals.marketAppraisals, "Live from REX — summed across every lettings agent.")
    : d.funnel.marketAppraisals;
  const funnelLiveListings = live?.totals
    ? asLive(live.totals.onMarketListings, "Live from REX — on-market listings right now.")
    : d.funnel.liveListings ?? d.funnel.listings;
  const funnelPipeline = live?.totals
    ? asLive(live.totals.pipeline, "Live from REX — let-agreed forward pipeline right now.")
    : d.funnel.pipeline;
  const funnelMoveIns: StatValue = live?.propoly
    ? {
        value: live.propoly.moveInsThisMonth,
        source: "live-propoly",
        note: "Live from Propoly — completed deals with a move-in date this month.",
        asOf: live.propoly.generatedAt.slice(0, 10),
      }
    : d.funnel.moveIns;

  const PERIODS = ["July", "June", "May", "April", "Q2 2026", "March", "February", "January", "Q1 2026", "YTD 2026"];

  return (
    <div className="space-y-5">
      {/* ---- headline band ---- */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide">
            KPI Metrics · July MTD
          </h2>
          <span className="text-[11px] text-muted">
            Snapshot {d.headline.lastUpdated} · live tiles refresh on load
          </span>
          <button
            type="button"
            onClick={() => void loadLive(true)}
            disabled={liveLoading}
            className="hide-when-presenting ml-auto inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-[12px] font-medium text-muted transition hover:text-ink disabled:opacity-50"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M13 8a5 5 0 1 1-1.46-3.54M13 3v2.5h-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {liveLoading ? "Refreshing…" : "Refresh live"}
          </button>
        </div>
        <div className={TILE_GRID}>
          <Tile label="Jun YTD MAs" stat={d.headline.mas} />
          <Tile label="Jun YTD Listings" stat={d.headline.listings} />
          <Tile label="Jun YTD Applications" stat={d.headline.applications} />
          <Tile label="Jun YTD Move-ins" stat={d.headline.moveIns} />
          <Tile label="Jun YTD GCI exc VAT" stat={d.headline.gciExcVat} />
          <Tile label="Jun YTD Total Income" stat={d.headline.totalIncome} />
          <Tile label="Jun YTD Pipeline" stat={d.headline.pipeline} />
        </div>
      </div>

      {/* ---- 1. Agent Headcount ---- */}
      <Section title="Agent Headcount — July 2026" source={d.sources.headcount}>
        <div className={TILE_GRID}>
          <Tile label="Active Agents" stat={d.headcount.activeAgents} sub="Managing portfolio" />
          <Tile label="TLE" stat={d.headcount.tle} sub="Full partner" />
          <Tile label="TLE Dual" stat={d.headcount.tleDual} sub="Dual brand" />
          <Tile label="Lettings Lite" stat={d.headcount.lettingsLite} sub="Lite service" />
          <Tile label="Starting Soon" stat={d.headcount.startingSoon} sub="Signed, building pipeline" />
          <Tile label="Starters YTD" stat={d.headcount.startersYtd} sub="TLE / TLE Dual · excl Lettings Lite" />
          <Tile label="Leavers YTD" stat={d.headcount.leaversYtd} sub="TLE / TLE Dual · excl Lettings Lite" />
          <Tile label="Variance YTD" stat={d.headcount.varianceYtd} sub="Net change TLE / TLE Dual" />
        </div>
      </Section>

      {/* ---- 2. Partner Productivity & Ramp Time ---- */}
      <Section
        title="Partner Productivity & Ramp Time"
        source={`${d.sources.headcount} · REX KPI reports · Target: MA months 1–2 · MI within 60 days`}
      >
        <PeriodPills periods={PERIODS} />
        <div className={TILE_GRID}>
          <Tile label="New Starters" stat={d.partnerRamp.newStarters} sub={d.partnerRamp.note} />
          <Tile label="MA in Months 1–2" stat={d.partnerRamp.maInMonths1To2} sub={subNote(d.partnerRamp.maInMonths1To2)} />
          <Tile label="Listing in Months 1–2" stat={d.partnerRamp.listingInMonths1To2} sub={subNote(d.partnerRamp.listingInMonths1To2)} />
          <Tile label="Move-in within 60 Days" stat={d.partnerRamp.moveInWithin60Days} sub={subNote(d.partnerRamp.moveInWithin60Days)} />
        </div>
      </Section>

      {/* ---- 3. Business KPIs — Sales Funnel ---- */}
      <Section title="Business KPIs" source={d.sources.businessFunnel}>
        <PeriodPills periods={["July MTD", ...PERIODS.slice(1)]} />
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Sales Funnel</h3>
        <div className={TILE_GRID}>
          <Tile label="Market Appraisals" stat={funnelMas} />
          <Tile label="Listings" stat={d.funnel.listings} />
          <Tile label="Viewings" stat={d.funnel.viewings} />
          <Tile label="Applications" stat={d.funnel.applications} />
          <Tile label="Move-ins" stat={funnelMoveIns} />
          <Tile label="Live Listings" stat={funnelLiveListings} />
          <Tile label="Forward Pipeline" stat={funnelPipeline} />
        </div>
      </Section>

      {/* ---- 4. Conversion Rates ---- */}
      <Section title="Conversion Rates" source={d.sources.conversions}>
        <div className={TILE_GRID}>
          <Tile label="MA → Listing" stat={d.conversions.maToListing} sub={subNote(d.conversions.maToListing)} />
          <Tile label="Listing → Move-in" stat={d.conversions.listingToMoveIn} sub={subNote(d.conversions.listingToMoveIn)} />
          {d.conversions.rlpConversion ? (
            <Tile label="RLP Conversion" stat={d.conversions.rlpConversion} sub={subNote(d.conversions.rlpConversion)} />
          ) : null}
          {d.conversions.gciPerMoveIn ? (
            <Tile label="GCI per Move-in" stat={d.conversions.gciPerMoveIn} sub={subNote(d.conversions.gciPerMoveIn)} />
          ) : null}
          {d.conversions.gciPerAgent ? (
            <Tile label="GCI per Agent" stat={d.conversions.gciPerAgent} sub={subNote(d.conversions.gciPerAgent)} />
          ) : null}
        </div>
      </Section>

      {/* ---- 5. MAs by Partner Type ---- */}
      <Section title="Market Appraisals by Partner Type" source={d.sources.masByPartnerType}>
        <div className={TILE_GRID}>
          <Tile label="Total Appraisals" stat={d.masByPartnerType.total} />
          <Tile label="TLE Partners" stat={d.masByPartnerType.tle} />
          <Tile label="TLE Dual" stat={d.masByPartnerType.tleDual} />
          <Tile label="Lettings Lite" stat={d.masByPartnerType.lettingsLite} />
        </div>
      </Section>

      {/* ---- 6. Monthly GCI vs Budget ---- */}
      <Section title="Monthly GCI vs Budget" source={d.sources.income}>
        <Bars
          labels={d.gciByMonth.labels}
          series={[{ name: "Actual GCI (exc VAT)", color: "#e31f36", values: d.gciByMonth.actual }]}
          format={(n) => `£${Math.round(n / 1000)}k`}
          height={240}
        />
        <p className="hide-when-presenting mt-2 text-[11px] text-muted">{d.gciByMonth.budgetNote}</p>
      </Section>

      {/* ---- 7. Year on Year Growth ---- */}
      <Section title="Year on Year Growth" source={d.sources.yoyGrowth}>
        <div className={TILE_GRID}>
          {d.yoyGrowth.map((g) => (
            <Tile key={g.label} label={g.label} stat={g.stat} sub={subNote(g.stat)} />
          ))}
        </div>
      </Section>

      {live?.totals ? (
        <p className="hide-when-presenting text-[11px] text-muted">
          Live tiles: REX summed across {live.agentsCounted} lettings agents
          {live.propoly ? " · move-ins live from Propoly" : ""} · everything grey is the {d.headline.lastUpdated} snapshot, and
          goes live as each integration lands (PayProp next for the money figures).
        </p>
      ) : live?.propoly ? (
        <p className="hide-when-presenting text-[11px] text-muted">
          Move-ins live from Propoly · REX live sums appear on the deployed site · grey tiles are the {d.headline.lastUpdated}{" "}
          snapshot until each integration lands.
        </p>
      ) : null}
    </div>
  );
}
