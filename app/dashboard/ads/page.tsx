"use client";

import { useEffect, useState } from "react";
import BrandMark from "@/components/BrandMark";
import { formatGBP, formatNum } from "@/lib/format";

// My Ads — live gallery of every ad in the agent's tagged Meta campaign(s),
// each with its creative thumbnail and its own spend / leads / CPL for the
// chosen date range. Friendly empty state until the admin links a campaign.

// Mirrors META_DATE_PRESETS in lib/meta.ts (server-only module — can't import
// it here). Keep the ids in sync.
const PRESETS = [
  { id: "last_7d", label: "7 days" },
  { id: "last_14d", label: "14 days" },
  { id: "last_30d", label: "30 days" },
  { id: "last_90d", label: "90 days" },
] as const;

interface AdRow {
  id: string;
  name: string;
  status: string;
  imageUrl: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  cpl: number | null;
}

interface AdsResponse {
  configured: boolean;
  preset?: string;
  ads?: AdRow[];
  error?: string;
}

function StatusPill({ status }: { status: string }) {
  const active = status === "ACTIVE";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${
        active
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-gray-200 bg-gray-100 text-gray-500"
      }`}
    >
      {active ? "ACTIVE" : status.replaceAll("_", " ")}
    </span>
  );
}

export default function MyAdsPage() {
  const [preset, setPreset] = useState<string>("last_30d");
  const [data, setData] = useState<AdsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/my/ads?preset=${preset}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Couldn't load your ads.");
        return (await res.json()) as AdsResponse;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Something went wrong.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preset, reloadKey]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">My Ads</h1>
          <p className="mt-0.5 text-[13px] text-muted">
            Live from Meta — every ad in your campaign, with its own figures.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-line bg-card p-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${
                preset === p.id
                  ? "accent-soft-bg accent-text"
                  : "text-muted hover:text-ink"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card h-72 animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="card p-6 text-center text-sm text-muted">
          {error}{" "}
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="font-medium accent-text underline-offset-2 hover:underline"
          >
            Try again
          </button>
        </div>
      ) : !data?.configured ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <BrandMark size={44} />
          <div className="text-sm font-semibold">
            Your ads aren&apos;t wired up yet
          </div>
          <p className="max-w-md text-[13px] text-muted">
            The admin links your Meta campaign to your portal account — once
            that&apos;s done, every live ad appears here with its spend, leads
            and cost per lead. No action needed from you.
          </p>
        </div>
      ) : data.error ? (
        <div className="card p-6 text-center text-[13px] text-muted">
          Couldn&apos;t reach Meta just now — try again in a minute. ({data.error})
        </div>
      ) : (data.ads ?? []).length === 0 ? (
        <div className="card p-10 text-center text-[13px] text-muted">
          No ads found in your linked campaign yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(data.ads ?? []).map((ad) => (
            <div key={ad.id} className="card overflow-hidden">
              <div className="relative aspect-[4/3] bg-gray-50">
                {ad.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ad.imageUrl}
                    alt={ad.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <BrandMark size={40} className="opacity-40" />
                  </div>
                )}
                <div className="absolute left-3 top-3">
                  <StatusPill status={ad.status} />
                </div>
              </div>
              <div className="p-4">
                <div className="truncate text-[13px] font-semibold" title={ad.name}>
                  {ad.name}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Spend
                    </div>
                    <div className="tnum mt-0.5 text-[15px] font-semibold">
                      {formatGBP(ad.spend)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Leads
                    </div>
                    <div className="tnum mt-0.5 text-[15px] font-semibold">
                      {formatNum(ad.leads)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      CPL
                    </div>
                    <div className="tnum mt-0.5 text-[15px] font-semibold">
                      {ad.cpl != null ? formatGBP(ad.cpl, true) : "—"}
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-muted">
                  {formatNum(ad.impressions)} impressions ·{" "}
                  {formatNum(ad.clicks)} clicks
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
