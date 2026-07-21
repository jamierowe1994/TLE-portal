"use client";

// Admin · Overview — a CUSTOMISABLE, decluttered dashboard. Each section is a
// titled block Susan can drag by its title, resize (S/M/L = half/¾/full width),
// and switch view (cards / bar / pie / line / funnel). Cards reflow to fit the
// block at any width (auto-fill grid) so nothing crushes. Layout persists per
// browser. Figures come from GET /api/admin/overview (admin-gated).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import StatCard from "@/components/StatCard";
import FunnelBar from "@/components/charts/FunnelBar";
import Donut from "@/components/charts/Donut";
import Bars from "@/components/charts/Bars";
import Line from "@/components/charts/Line";
import CustomizableGrid, { type DashBlock, type ViewType } from "@/components/CustomizableGrid";
import type { SeedData } from "@/lib/seed-data";
import type { StatValue } from "@/lib/types";
import { formatGBP, formatNum, monthLabel } from "@/lib/format";

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

function agoLabel(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} mins ago`;
  const h = Math.round(mins / 60);
  return h === 1 ? "1 hour ago" : `${h} hours ago`;
}

function liveStat(value: number, display?: string): StatValue {
  return { value, display, source: "live-rex", asOf: new Date().toISOString().slice(0, 10) };
}

function livePropolyStat(value: number, note?: string): StatValue {
  return { value, source: "live-propoly", note, asOf: new Date().toISOString().slice(0, 10) };
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

/* ------------------------------ render helpers ------------------------------ */

// Auto-fill grid: cards keep a minimum width and wrap — they never crush into
// slivers when the block is narrow.
const CARD_GRID = "grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]";

// Title with an optional click-to-reveal source line — keeps the block clean by
// default, with the detail one tap away rather than always underneath.
function Titled({ title, source, children }: { title: string; source?: string; children: ReactNode }) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide">{title}</h2>
        {source ? (
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            aria-expanded={showInfo}
            aria-label="Source & detail"
            title="Source"
            className="hide-when-presenting flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line text-[10px] font-semibold leading-none text-muted transition hover:border-accent hover:text-accent"
          >
            i
          </button>
        ) : null}
      </div>
      {showInfo && source ? (
        <p className="mb-2 text-[11px] text-muted">Source: {source}</p>
      ) : null}
      {children}
    </div>
  );
}

function ChartCard({ children }: { children: ReactNode }) {
  return <div className="card p-5">{children}</div>;
}

// A one-line, click-to-expand note — keeps long explanations out of the way.
function DetailNote({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="hide-when-presenting mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-[11px] font-medium text-muted underline decoration-dotted underline-offset-2 transition hover:text-ink"
      >
        {open ? "Hide detail" : label}
      </button>
      {open ? <p className="mt-1 text-[11px] leading-relaxed text-muted">{children}</p> : null}
    </div>
  );
}

const num = (s: StatValue) => s.value ?? 0;

/* ---------------------------------- tab ---------------------------------- */

export default function Overview({ month }: { month: string }) {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveBusiness | null>(null);
  const [liveState, setLiveState] = useState<"loading" | "ready" | "off" | "error">("loading");

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

  // Live REX business aggregate — loaded in the background (heavy pull, cached).
  const loadLive = useCallback(
    async (refresh = false) => {
      setLiveState("loading");
      try {
        const res = await fetch(
          `/api/admin/live-business?month=${encodeURIComponent(month)}${refresh ? "&refresh=1" : ""}`,
          { cache: "no-store" }
        );
        const j = await res.json();
        if (j?.configured === false) {
          // REX off — Propoly may still have answered; keep whatever we got.
          setLive(j as LiveBusiness);
          setLiveState("off");
          return;
        }
        setLive(j as LiveBusiness);
        setLiveState("ready");
      } catch {
        setLiveState("error");
      }
    },
    [month]
  );

  useEffect(() => {
    void loadLive();
  }, [loadLive]);

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

    // Trimmed to the five headcount figures Susan reads most.
    const headcountItems = [
      { label: "Active Agents", stat: d.headcount.activeAgents, sub: "Managing portfolio" },
      { label: "TLE", stat: d.headcount.tle, sub: "Full partner" },
      { label: "TLE Dual", stat: d.headcount.tleDual, sub: "Dual brand" },
      { label: "Lettings Lite", stat: d.headcount.lettingsLite, sub: "Lite service" },
      { label: "Variance YTD", stat: d.headcount.varianceYtd, sub: "Net change" },
    ];

    const masSegments = [
      { label: "TLE Partners", value: num(d.masByPartnerType.tle), color: "#e31f36" },
      { label: "TLE Dual", value: num(d.masByPartnerType.tleDual), color: "#111827" },
      { label: "Lettings Lite", value: num(d.masByPartnerType.lettingsLite), color: "#9ca3af" },
    ];

    const liveBlock: DashBlock = {
      id: "liveBusiness",
      title: "Live from REX",
      defaultSpan: 4,
      views: ["cards"] as const,
      render: () => (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide">Live — Business (REX + Propoly)</h2>
            {liveState === "ready" && live?.generatedAt ? (
              <span className="text-[11px] text-muted">
                {live.agentsCounted} agents · updated {agoLabel(live.generatedAt)}
              </span>
            ) : null}
            {liveState !== "off" ? (
              <button
                type="button"
                onClick={() => void loadLive(true)}
                disabled={liveState === "loading"}
                className="hide-when-presenting ml-auto inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-[12px] font-medium text-muted transition hover:text-ink disabled:opacity-50"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M13 8a5 5 0 1 1-1.46-3.54M13 3v2.5h-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {liveState === "loading" ? "Refreshing…" : "Refresh"}
              </button>
            ) : null}
          </div>

          {liveState === "off" ? (
            live?.propoly ? (
              <>
                <div className={CARD_GRID}>
                  <StatCard
                    size="sm"
                    label="Progression pipeline"
                    stat={livePropolyStat(live.propoly.pipelineTotal, "Live from Propoly — every deal from deal started to signing & move-in monies.")}
                    sub="Propoly · whole business"
                  />
                  <StatCard
                    size="sm"
                    label="Move-ins"
                    stat={livePropolyStat(live.propoly.moveInsThisMonth, "Completed Propoly deals with a move-in date this month.")}
                    sub={`${monthLabel(live.propoly.month).split(" ")[0]} · completed`}
                  />
                  {live.propoly.pipelineByStage
                    .filter((s) => s.count > 0)
                    .slice(0, 3)
                    .map((s) => (
                      <StatCard key={s.key} size="sm" label={s.label} stat={livePropolyStat(s.count)} sub="In progression" />
                    ))}
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  REX isn&apos;t connected on this server — showing the live Propoly figures.
                </p>
              </>
            ) : (
              <div className="card p-5 text-[13px] text-muted">
                REX isn&apos;t connected on this server, so live business figures aren&apos;t available here.
              </div>
            )
          ) : liveState === "error" ? (
            <div className="card p-5 text-[13px] text-muted">
              Couldn&apos;t reach REX just now.{" "}
              <button className="accent-text underline" onClick={() => void loadLive(true)}>Try again</button>
            </div>
          ) : liveState === "loading" && !live ? (
            <div className={CARD_GRID}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="card h-24 animate-pulse" />
              ))}
            </div>
          ) : live && live.totals ? (
            <>
              {/* Managed & rent roll are a REX cut that reads LOW against the
                  official PayProp totals, so they're kept out of presentation —
                  the room sees the official figures for those instead. The rest
                  are trustworthy live pulls and present as-is. */}
              <div className={CARD_GRID}>
                <StatCard size="sm" label="Market Appraisals" stat={liveStat(live.totals.marketAppraisals)} sub={`${monthLabel(live.month).split(" ")[0]} so far`} />
                <StatCard size="sm" label="On-market Listings" stat={liveStat(live.totals.onMarketListings)} sub="Taking viewings" />
                <StatCard size="sm" label="Pipeline" stat={liveStat(live.totals.pipeline)} sub="Let agreed" />
                {live.propoly ? (
                  <>
                    <StatCard
                      size="sm"
                      label="Progression pipeline"
                      stat={livePropolyStat(live.propoly.pipelineTotal, "Live from Propoly — every deal from deal started to signing & move-in monies.")}
                      sub="Propoly · in progression"
                    />
                    <StatCard
                      size="sm"
                      label="Move-ins"
                      stat={livePropolyStat(live.propoly.moveInsThisMonth, "Completed Propoly deals with a move-in date this month.")}
                      sub={`${monthLabel(live.propoly.month).split(" ")[0]} · completed`}
                    />
                  </>
                ) : null}
                <div className="hide-when-presenting">
                  <StatCard size="sm" label="Managed (REX)" stat={liveStat(live.totals.managed)} sub="Let & managed" />
                </div>
                <div className="hide-when-presenting">
                  <StatCard size="sm" label="Rent Roll (REX)" stat={liveStat(live.totals.rentRoll, formatGBP(live.totals.rentRoll))} sub="Per month" />
                </div>
              </div>
              <DetailNote label="How these figures are calculated">
                Summed live from REX across {live.agentsCounted} lettings agents. Listings &amp; pipeline are live REX
                figures. Progression pipeline &amp; move-ins are live from Propoly (tenancy progression) across the whole
                business. Managed &amp; rent roll are a REX cut and read lower than the PayProp portfolio report (Glasgow
                and rent-collect properties aren&apos;t in this pull) — the PayProp figures below remain the official
                totals until that integration lands.
              </DetailNote>
            </>
          ) : null}
        </div>
      ),
    };

    return [
      liveBlock,
      {
        id: "headline",
        title: "Headline KPIs",
        defaultSpan: 4,
        views: ["cards"] as const,
        render: () => (
          <Titled title={`Headline — ${d.headline.label}`} source="REX KPI reports · Move-in report · PayProp">
            <div className={CARD_GRID}>
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
        id: "conversions",
        title: "Conversion Rates",
        defaultSpan: 2,
        views: ["cards"] as const,
        render: () => (
          <Titled title="Conversion Rates — July MTD" source={d.sources.conversions}>
            <div className={CARD_GRID}>
              <StatCard size="sm" label="MA → Listing" stat={d.conversions.maToListing} />
              <StatCard size="sm" label="Listing → Move-in" stat={d.conversions.listingToMoveIn} />
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
              <div className={CARD_GRID}>
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
              <div className={CARD_GRID}>
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
        id: "gciByMonth",
        title: "Monthly GCI",
        defaultSpan: 2,
        views: ["bar", "line"] as const,
        render: (v: ViewType) => (
          <Titled title="Monthly GCI — Jan–Jun 2026" source={d.sources.income}>
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
            </ChartCard>
          </Titled>
        ),
      },
    ];
  }, [data, live, liveState, loadLive]);

  if (error) {
    return <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">{error}</p>;
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

      {/* Source-dot legend */}
      <div className="hide-when-presenting mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="font-medium">Source:</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#22c55e" }} /> Live</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#9ca3af" }} /> Snapshot</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#f59e0b" }} /> Manual</span>
        <span className="text-muted">· hover any figure for detail</span>
      </div>

      <CustomizableGrid blocks={blocks} storageKey="tle_admin_overview_v3" />
    </div>
  );
}
