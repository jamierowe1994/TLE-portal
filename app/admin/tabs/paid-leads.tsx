"use client";

// Admin tab: Paid leads & pro licence (GoHighLevel — no API access yet), plus a
// live Socials snapshot (Facebook + Instagram followers + growth) pulled from
// the sister ads platform's partner API.

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import FunnelBar from "@/components/charts/FunnelBar";
import TimescaleSelect from "@/components/TimescaleSelect";
import type { SeedData } from "@/lib/seed-data"; // type-only — erased at build
import { monthLabel } from "@/lib/format";

/* ------------------------------- socials ------------------------------- */

interface SocialPlatform {
  configured: boolean;
  followers: number | null;
  gained: number | null;
  handle: string | null;
  error?: string;
}
interface SocialSnap {
  facebook: SocialPlatform;
  instagram: SocialPlatform;
}

const SOCIAL_PRESETS = [
  { id: "last_7d", label: "Last 7 days" },
  { id: "last_30d", label: "Last 30 days" },
  { id: "last_90d", label: "Last 90 days" },
] as const;

const FB_ICON =
  "M13 22v-9h3l.5-3.5H13V7.3c0-1 .3-1.7 1.8-1.7H16.6V2.4C16.3 2.4 15.2 2.3 14 2.3c-2.6 0-4.3 1.6-4.3 4.5v2.7H6.6V13h3.1v9H13z";
const IG_ICON =
  "M12 8.2A3.8 3.8 0 1012 15.8 3.8 3.8 0 0012 8.2zm0 6.3a2.5 2.5 0 110-5 2.5 2.5 0 010 5zM17 5.6a.9.9 0 100 1.8.9.9 0 000-1.8zM12 4.6c2.4 0 2.7 0 3.7.06 2.5.1 3.6 1.3 3.7 3.7.05 1 .06 1.3.06 3.7s0 2.7-.06 3.7c-.1 2.4-1.2 3.6-3.7 3.7-1 .05-1.3.06-3.7.06s-2.7 0-3.7-.06c-2.5-.1-3.6-1.3-3.7-3.7C4.6 14.7 4.6 14.4 4.6 12s0-2.7.06-3.7c.1-2.4 1.2-3.6 3.7-3.7 1-.05 1.3-.06 3.7-.06zM12 3.3c-2.4 0-2.8 0-3.7.05C4.9 3.5 3.5 4.9 3.4 8.3c-.05.9-.05 1.3-.05 3.7s0 2.8.05 3.7c.1 3.4 1.5 4.8 4.9 4.9.9.05 1.3.05 3.7.05s2.8 0 3.7-.05c3.4-.1 4.8-1.5 4.9-4.9.05-.9.05-1.3.05-3.7s0-2.8-.05-3.7c-.1-3.4-1.5-4.8-4.9-4.9-.9-.05-1.3-.05-3.7-.05z";

const fmt = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-GB");
const fmtGained = (n: number | null) =>
  n == null ? "" : `${n > 0 ? "+" : ""}${n.toLocaleString("en-GB")}`;

function PlatformCard({
  label,
  icon,
  iconBg,
  data,
  windowLabel,
}: {
  label: string;
  icon: string;
  iconBg: string;
  data: SocialPlatform;
  windowLabel: string;
}) {
  const gainedColor =
    data.gained == null
      ? "text-muted"
      : data.gained > 0
        ? "text-emerald-600"
        : data.gained < 0
          ? "text-accent"
          : "text-muted";
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white"
          style={{ background: iconBg }}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d={icon} />
          </svg>
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">{label}</div>
          {data.handle ? (
            <div className="truncate text-xs text-muted">{data.handle}</div>
          ) : null}
        </div>
      </div>
      {!data.configured ? (
        <p className="mt-3 text-[13px] text-amber-600">Not connected</p>
      ) : data.error || data.followers == null ? (
        <p className="mt-3 text-[13px] text-amber-600">Needs Meta access</p>
      ) : (
        <div className="mt-3 flex items-baseline gap-3">
          <span className="stat-value text-[30px]">{fmt(data.followers)}</span>
          {data.gained != null ? (
            <span className={`text-sm font-semibold ${gainedColor}`}>
              {fmtGained(data.gained)}{" "}
              <span className="text-xs font-normal text-muted">{windowLabel}</span>
            </span>
          ) : null}
        </div>
      )}
      <div className="mt-1 text-xs text-muted">Followers</div>
    </div>
  );
}

function SocialsSection() {
  const [preset, setPreset] = useState<string>("last_30d");
  const [social, setSocial] = useState<SocialSnap | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "off">(
    "loading"
  );
  const windowLabel =
    SOCIAL_PRESETS.find((p) => p.id === preset)?.label ?? "";

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetch(`/api/admin/social?preset=${preset}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { configured?: boolean; social?: SocialSnap | null }) => {
        if (cancelled) return;
        if (!d.configured) {
          setState("off");
          return;
        }
        setSocial(d.social ?? null);
        setState(d.social ? "ready" : "error");
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [preset]);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Socials</h2>
          <p className="mt-0.5 text-xs text-muted">
            Live from Meta · followers now &amp; growth over the window
          </p>
        </div>
        <TimescaleSelect
          value={preset}
          options={SOCIAL_PRESETS}
          onChange={setPreset}
          disabled={state === "loading"}
        />
      </div>

      {state === "off" ? (
        <div className="card p-5 text-[13px] text-muted">
          Socials connection isn&rsquo;t wired up yet.
        </div>
      ) : state === "error" ? (
        <div className="card p-5 text-[13px] text-muted">
          Couldn&rsquo;t load socials right now — try again shortly.
        </div>
      ) : state === "loading" && !social ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card h-28 animate-pulse" />
          <div className="card h-28 animate-pulse" />
        </div>
      ) : social ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <PlatformCard
            label="Facebook"
            icon={FB_ICON}
            iconBg="#1877F2"
            data={social.facebook}
            windowLabel={windowLabel}
          />
          <PlatformCard
            label="Instagram"
            icon={IG_ICON}
            iconBg="linear-gradient(45deg, #F58529 0%, #DD2A7B 45%, #8134AF 75%, #515BD4 100%)"
            data={social.instagram}
            windowLabel={windowLabel}
          />
        </div>
      ) : null}
    </section>
  );
}

/* --------------------------------- tab --------------------------------- */

export default function PaidLeadsTab({ month, seed }: { month: string; seed: SeedData }) {
  const pl = seed.paidLeads;
  const isSnapshotMonth = month === "2026-07";

  return (
    <div className="space-y-6">
      {/* Live socials snapshot (Facebook + Instagram) */}
      <SocialsSection />

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
