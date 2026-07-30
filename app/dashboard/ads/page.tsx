"use client";

import { useCallback, useEffect, useState } from "react";
import BrandMark from "@/components/BrandMark";
import TimescaleSelect from "@/components/TimescaleSelect";
import { getUser } from "@/lib/session";
import { formatGBP, formatNum, formatPct } from "@/lib/format";

// My Ads — connects the agent to the sister Ads app (auto-matched by email),
// shows a campaign overview (spend + key metrics) and a compact tile per ad.

const PRESETS = [
  { id: "this_month", label: "This month" },
  { id: "last_30d", label: "Last 30 days" },
  { id: "last_60d", label: "Last 60 days" },
  { id: "last_90d", label: "Last 90 days" },
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

interface Snapshot {
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  cpl: number | null;
  datePreset: string;
}

function StatusPill({ status }: { status: string }) {
  const active = status === "ACTIVE";
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide ${
        active ? "border-green-200 bg-green-50 text-green-700" : "border-gray-200 bg-gray-100 text-gray-500"
      }`}
    >
      {active ? "ACTIVE" : status.replaceAll("_", " ")}
    </span>
  );
}

function OverviewStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="stat-value mt-1.5 text-[24px]">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}

export default function MyAdsPage() {
  const [preset, setPreset] = useState<string>("this_month");
  const [data, setData] = useState<AdsResponse | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const email = getUser()?.email ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [adsRes, metaRes] = await Promise.all([
        fetch(`/api/my/ads?preset=${preset}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/my/meta?preset=${preset}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      setData(adsRes as AdsResponse);
      setSnap(metaRes && metaRes.configured ? (metaRes.snapshot as Snapshot) : null);
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
      if (!res.ok || !j.connected) setConnectError(j.error ?? "Couldn't connect your ads.");
      else setReloadKey((k) => k + 1);
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
  const presetLabel = PRESETS.find((p) => p.id === preset)?.label ?? "";

  // Overview totals — prefer the campaign snapshot; fall back to summing ads.
  const totals = snap
    ? {
        spend: snap.spend,
        leads: snap.leads,
        impressions: snap.impressions,
        clicks: snap.clicks,
        cpl: snap.cpl,
      }
    : ads.length
      ? {
          spend: ads.reduce((t, a) => t + a.spend, 0),
          leads: ads.reduce((t, a) => t + a.leads, 0),
          impressions: ads.reduce((t, a) => t + a.impressions, 0),
          clicks: ads.reduce((t, a) => t + a.clicks, 0),
          cpl: null as number | null,
        }
      : null;
  const ctr = totals && totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null;
  const cpl = totals?.cpl ?? (totals && totals.leads > 0 ? totals.spend / totals.leads : null);

  return (
    <div className="outline-cards space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="tracking-tight" style={{ fontSize: "clamp(32px, 3.6vw, 46px)", lineHeight: 1.05, fontWeight: 500 }}>My Ads</h1>
          <p className="mt-0.5 text-[13px] text-muted">
            Your live Meta ads — spend, leads and cost per lead, straight from the ads platform.
          </p>
        </div>
        {connected && data?.configured ? (
          <div className="ml-auto flex items-center gap-2">
            <TimescaleSelect value={preset} options={PRESETS} onChange={setPreset} disabled={loading} />
            <button
              onClick={() => void disconnect()}
              className="rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-[12px] font-medium text-muted hover:text-ink"
              title="Disconnect your ads"
            >
              Disconnect
            </button>
          </div>
        ) : null}
      </div>

      {loading && !data ? (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
            <div className="card h-40 animate-pulse" />
            <div className="card h-40 animate-pulse" />
          </div>
        </div>
      ) : !data?.canConnect ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <BrandMark size={44} />
          <div className="text-sm font-semibold">Ad connection coming soon</div>
          <p className="max-w-md text-[13px] text-muted">
            Head office is setting up the link to the ads platform. Once it&apos;s on, you&apos;ll be able to
            connect your ads here in one click.
          </p>
        </div>
      ) : !connected ? (
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
            className="rounded-lg border border-line bg-transparent px-3 py-1.5 text-[13px] font-medium text-muted hover:text-ink"
          >
            Refresh
          </button>
          <button onClick={() => void disconnect()} className="text-[12px] text-muted underline hover:text-ink">
            Disconnect
          </button>
        </div>
      ) : (
        <>
          {/* ---- Overview: big spend + key metrics ---- */}
          {totals ? (
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
              <div className="card flex flex-col justify-center p-6">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                  Total spend · {presetLabel}
                </div>
                <div
                  className="mt-1 font-semibold tracking-tight tnum"
                  style={{ fontSize: "clamp(40px, 4.4vw, 56px)", lineHeight: 1.05 }}
                >
                  {formatGBP(totals.spend)}
                </div>
                <div className="mt-1.5 text-xs text-muted">
                  across {ads.length} ad{ads.length === 1 ? "" : "s"}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <OverviewStat label="Leads" value={formatNum(totals.leads)} sub="Total this period" />
                <OverviewStat label="Impressions" value={formatNum(totals.impressions)} sub={`${formatNum(totals.clicks)} clicks`} />
                <OverviewStat label="Click-through rate" value={formatPct(ctr, 1)} sub="Clicks ÷ impressions" />
                <OverviewStat label="Cost per lead" value={cpl != null ? formatGBP(cpl, true) : "—"} sub="Spend ÷ leads" />
              </div>
            </section>
          ) : null}

          {/* faint grey divider */}
          <hr className="border-line" />

          {/* ---- Ad tiles (compact) ---- */}
          {ads.length === 0 ? (
            <div className="card p-10 text-center text-[13px] text-muted">No ads found in your campaign yet.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {ads.map((ad) => (
                <div key={ad.id} className="card overflow-hidden">
                  <div className="relative aspect-[4/3] bg-gray-50">
                    {ad.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ad.imageUrl} alt={ad.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <BrandMark size={28} className="opacity-40" />
                      </div>
                    )}
                    <div className="absolute left-2 top-2">
                      <StatusPill status={ad.status} />
                    </div>
                  </div>
                  <div className="p-2.5">
                    <div className="truncate text-[12px] font-semibold" title={ad.name}>
                      {ad.name}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px]">
                      <span className="text-muted">
                        Spend <span className="font-semibold text-ink tnum">{formatGBP(ad.spend)}</span>
                      </span>
                      <span className="text-muted">
                        Leads <span className="font-semibold text-ink tnum">{formatNum(ad.leads)}</span>
                      </span>
                      <span className="text-muted">
                        CPL <span className="font-semibold text-ink tnum">{ad.cpl != null ? formatGBP(ad.cpl, true) : "—"}</span>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
