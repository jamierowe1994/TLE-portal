"use client";

import { useCallback, useEffect, useState } from "react";
import BrandMark from "@/components/BrandMark";
import { getUser } from "@/lib/session";
import { formatGBP, formatNum } from "@/lib/format";

// My Ads — connects the agent to the sister Ads app (auto-matched by email) and
// shows every live ad in their campaign, each with its own spend / leads / CPL.

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
  connected: boolean;
  canConnect: boolean;
  configured: boolean;
  preset?: string;
  ads?: AdRow[];
  notFound?: boolean;
  error?: string;
}

function StatusPill({ status }: { status: string }) {
  const active = status === "ACTIVE";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${
        active ? "border-green-200 bg-green-50 text-green-700" : "border-gray-200 bg-gray-100 text-gray-500"
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
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const email = getUser()?.email ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/my/ads?preset=${preset}`, { cache: "no-store" });
      setData((await res.json()) as AdsResponse);
    } catch {
      setData({ connected: false, canConnect: false, configured: false, error: "Something went wrong." });
    } finally {
      setLoading(false);
    }
  }, [preset]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  async function connect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await fetch("/api/my/ads-connect", { method: "POST" });
      const j = (await res.json()) as { connected: boolean; error?: string };
      if (!res.ok || !j.connected) {
        setConnectError(j.error ?? "Couldn't connect your ads.");
      } else {
        setReloadKey((k) => k + 1);
      }
    } catch {
      setConnectError("Couldn't connect your ads.");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    await fetch("/api/my/ads-connect", { method: "DELETE" }).catch(() => {});
    setReloadKey((k) => k + 1);
  }

  const connected = data?.connected;
  const ads = data?.ads ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">My Ads</h1>
          <p className="mt-0.5 text-[13px] text-muted">
            Your live Meta ads — spend, leads and cost per lead, straight from the ads platform.
          </p>
        </div>
        {connected && data?.configured ? (
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-line bg-card p-1">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${
                    preset === p.id ? "accent-soft-bg accent-text" : "text-muted hover:text-ink"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => void disconnect()}
              className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12px] font-medium text-muted hover:text-ink"
              title="Disconnect your ads"
            >
              Disconnect
            </button>
          </div>
        ) : null}
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card h-72 animate-pulse" />
          ))}
        </div>
      ) : !data?.canConnect ? (
        /* Owner hasn't wired the Ads-app link yet */
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <BrandMark size={44} />
          <div className="text-sm font-semibold">Ad connection coming soon</div>
          <p className="max-w-md text-[13px] text-muted">
            Head office is setting up the link to the ads platform. Once it&apos;s on, you&apos;ll be able to
            connect your ads here in one click.
          </p>
        </div>
      ) : !connected ? (
        /* Big Connect button */
        <div className="card flex flex-col items-center gap-4 p-12 text-center">
          <BrandMark size={48} />
          <div>
            <div className="text-lg font-semibold">Connect your live ads</div>
            <p className="mx-auto mt-1.5 max-w-md text-[13px] text-muted">
              Link your ads platform to see every live ad here — spend, leads and cost per lead, updating
              automatically. We&apos;ll match you by your email ({email || "your login email"}).
            </p>
          </div>
          <button
            onClick={() => void connect()}
            disabled={connecting}
            className="btn-press rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white transition hover:bg-accent-dark disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Connect my ads"}
          </button>
          {connectError ? <p className="max-w-md text-[13px] text-accent">{connectError}</p> : null}
        </div>
      ) : !data?.configured ? (
        /* Connected but no campaign / not found */
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <BrandMark size={44} />
          <div className="text-sm font-semibold">
            {data?.notFound ? "No ads found under your email yet" : "Your campaign isn't live yet"}
          </div>
          <p className="max-w-md text-[13px] text-muted">
            {data?.notFound
              ? `We connected, but couldn't find ads under ${email}. Check you use the same email on the ads platform.`
              : "You're connected — your ads will appear here as soon as your campaign is running on the platform."}
          </p>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium text-muted hover:text-ink"
          >
            Refresh
          </button>
          <button onClick={() => void disconnect()} className="text-[12px] text-muted underline hover:text-ink">
            Disconnect
          </button>
        </div>
      ) : ads.length === 0 ? (
        <div className="card p-10 text-center text-[13px] text-muted">No ads found in your campaign yet.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ads.map((ad) => (
            <div key={ad.id} className="card overflow-hidden">
              <div className="relative aspect-[4/3] bg-gray-50">
                {ad.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ad.imageUrl} alt={ad.name} className="h-full w-full object-cover" />
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
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Spend</div>
                    <div className="tnum mt-0.5 text-[15px] font-semibold">{formatGBP(ad.spend)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Leads</div>
                    <div className="tnum mt-0.5 text-[15px] font-semibold">{formatNum(ad.leads)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">CPL</div>
                    <div className="tnum mt-0.5 text-[15px] font-semibold">
                      {ad.cpl != null ? formatGBP(ad.cpl, true) : "—"}
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-muted">
                  {formatNum(ad.impressions)} impressions · {formatNum(ad.clicks)} clicks
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
