"use client";

// Admin tab: Diagnostics — integration status from /api/admin/status, env
// presence checklist, and the worklist of figures we couldn't match to a live
// source yet (so Susan/James can work through them one by one).

import { useEffect, useState } from "react";
import { SOURCES } from "@/lib/roster";
import { formatDate } from "@/lib/format";

/* ------------------------------ status payload ------------------------------ */

interface StatusPayload {
  rex: {
    ok: boolean;
    reason?: string;
    capabilities: Record<string, boolean>;
    lastError?: string;
    checkedAt?: string;
  };
  meta: {
    configured: { token: boolean; appSecret: boolean; adAccount: boolean; page: boolean };
  };
  propoly: { configured: boolean };
  payprop: { status: string };
  ghl: { status: string };
  env: { present: string[] };
}

// Same list the status route checks — names only, never values.
const ENV_CHECKLIST = [
  "AUTH_SECRET",
  "ADMIN_EMAILS",
  "DATABASE_URL",
  "DATA_DIR",
  "REX_API_BASE",
  "REX_API_EMAIL",
  "REX_API_PASSWORD",
  "REX_ACCOUNT_ID",
  "META_SYSTEM_TOKEN",
  "META_APP_SECRET",
  "META_AD_ACCOUNT_LETTINGS",
  "META_PAGE_LETTINGS",
  "PROPOLY_API_KEY",
  "PROPOLY_AGENT_NAME",
];

const REX_CAPABILITY_LABELS: Record<string, string> = {
  login: "REX login (UserProfile/getAccessibleAccounts)",
  accountUsers: "AccountUsers/search — map portal accounts to REX users",
  leadsSearch: "Leads/search — per-agent lead / MA-request counts by month",
  listingsModel: "Listings model discovered (describeModel)",
  appraisalsModel: "Appraisals model discovered (describeModel)",
};

// Figures we couldn't match to a live source yet — worked through one by one.
const WORKLIST: { system: string; items: string[] }[] = [
  {
    system: "REX (KPI funnel figures)",
    items: [
      "Market appraisals — business + per-agent (REX KPI reports)",
      "Listings, viewings, applications — funnel counts",
      "Live listings and forward pipeline counts",
      "Compliance items (REX PM module — live pull candidate)",
    ],
  },
  {
    system: "PayProp (GCI / portfolio / arrears)",
    items: [
      "Combined GCI and income actuals (E&W + Glasgow fee reports)",
      "Portfolio by partner, managed/let-only splits, rent roll",
      "Tenant arrears report (admin-only)",
    ],
  },
  {
    system: "Go High Level (paid leads)",
    items: [
      "Leads generated, referred to agents, MAs booked",
      "Lead → referral and lead → MA conversion",
    ],
  },
];

/* -------------------------------- UI helpers -------------------------------- */

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-green-500" : "bg-gray-300"}`}
      aria-hidden
    />
  );
}

function StatusPill({ tone, label }: { tone: "ok" | "warn" | "off"; label: string }) {
  const cls =
    tone === "ok"
      ? "border-green-200 bg-green-50 text-green-700"
      : tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-gray-200 bg-gray-100 text-gray-500";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

/* --------------------------------- the tab --------------------------------- */

export default function DiagnosticsTab({ month }: { month: string }) {
  void month; // diagnostics are not month-scoped
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/status", { cache: "no-store" });
        if (!res.ok) throw new Error(`Status check failed (${res.status})`);
        const data = (await res.json()) as StatusPayload;
        if (!cancelled) setStatus(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Status check failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const metaConfigured = status?.meta?.configured;
  const metaReady = !!(metaConfigured?.token && metaConfigured?.appSecret && metaConfigured?.adAccount);

  return (
    <div className="space-y-6">
      {loading ? (
        <div className="rounded-2xl border border-line bg-card px-4 py-3 text-[13px] text-muted">
          Checking integrations…
        </div>
      ) : null}
      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      ) : null}

      {/* Integration cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* REX */}
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">REX CRM</h2>
            <StatusPill
              tone={status?.rex?.ok ? "ok" : status?.rex?.reason === "not-configured" ? "off" : "warn"}
              label={
                status?.rex?.ok
                  ? "CONNECTED"
                  : status?.rex?.reason === "not-configured"
                    ? "NOT CONFIGURED"
                    : "ATTEMPTING"
              }
            />
          </div>
          <p className="mt-1 text-xs text-muted">{SOURCES.rex.note}</p>
          <ul className="mt-3 space-y-1.5 text-[13px]">
            {Object.entries(REX_CAPABILITY_LABELS).map(([cap, label]) => (
              <li key={cap} className="flex items-center gap-2">
                <Dot ok={status?.rex?.capabilities?.[cap] === true} />
                <span>{label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            What live pulls are possible: with login + AccountUsers we can link
            portal accounts to REX users; with Leads/search we can count each
            agent&rsquo;s lead records (MA requests) per month. Listings /
            appraisals reporting endpoints are still being discovered — until
            they answer, funnel figures fall back to the dashboard snapshot.
          </p>
          {status?.rex?.lastError ? (
            <p className="mt-2 text-xs text-accent">Last error: {status.rex.lastError}</p>
          ) : null}
          {status?.rex?.checkedAt ? (
            <p className="mt-1 text-xs text-muted">
              Last probed: {formatDate(status.rex.checkedAt)}
            </p>
          ) : null}
        </section>

        {/* Meta */}
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Meta Ads</h2>
            <StatusPill tone={metaReady ? "ok" : "warn"} label={metaReady ? "LIVE" : "PARTIAL CONFIG"} />
          </div>
          <p className="mt-1 text-xs text-muted">{SOURCES.meta.note}</p>
          <ul className="mt-3 space-y-1.5 text-[13px]">
            <li className="flex items-center gap-2">
              <Dot ok={!!metaConfigured?.token} /> System user token (META_SYSTEM_TOKEN)
            </li>
            <li className="flex items-center gap-2">
              <Dot ok={!!metaConfigured?.appSecret} /> App secret (META_APP_SECRET)
            </li>
            <li className="flex items-center gap-2">
              <Dot ok={!!metaConfigured?.adAccount} /> TLE ad account (META_AD_ACCOUNT_LETTINGS)
            </li>
            <li className="flex items-center gap-2">
              <Dot ok={!!metaConfigured?.page} /> TLE Facebook page (META_PAGE_LETTINGS)
            </li>
          </ul>
        </section>

        {/* Propoly */}
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Propoly</h2>
            <StatusPill
              tone={status?.propoly?.configured ? "ok" : "off"}
              label={status?.propoly?.configured ? "CONFIGURED" : "NOT CONFIGURED"}
            />
          </div>
          <p className="mt-1 text-xs text-muted">
            Tenancy progression — referencing, Right to Rent, AML and digital
            agreements. Auth: x-api-key + agent-name → JWT.
          </p>
          <p className="mt-3 text-[13px]">
            Candidate live source for <span className="font-semibold">Applications</span>{" "}
            and the <span className="font-semibold">Pipeline</span> stat (their
            &ldquo;deals&rdquo; are lets in progression). Once configured, open{" "}
            <code className="text-xs">/api/admin/propoly-probe</code> to see the
            real response shapes and wire the mappings.
          </p>
        </section>

        {/* PayProp */}
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">PayProp</h2>
            <StatusPill tone="off" label="NO ACCESS YET" />
          </div>
          <p className="mt-1 text-xs text-muted">{SOURCES.payprop.note}</p>
          <p className="mt-3 text-[13px]">
            Feeds the <span className="font-semibold">Portfolio</span>,{" "}
            <span className="font-semibold">Arrears</span> and{" "}
            <span className="font-semibold">Income</span> actuals. Once API
            access is granted, a future <code className="text-xs">lib/payprop.ts</code>{" "}
            slots into the same live → manual → snapshot chain.
          </p>
        </section>

        {/* GHL */}
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Go High Level</h2>
            <StatusPill tone="off" label="NO ACCESS YET" />
          </div>
          <p className="mt-1 text-xs text-muted">{SOURCES.ghl.note}</p>
          <p className="mt-3 text-[13px]">
            Feeds the <span className="font-semibold">Paid Leads</span> tab —
            leads generated, referrals to agents and MAs booked.
          </p>
        </section>
      </div>

      {/* Env presence */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold">Environment variables</h2>
        <p className="mt-1 text-xs text-muted">
          Presence only — secret values never leave the server.
        </p>
        <ul className="mt-3 grid gap-1.5 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          {ENV_CHECKLIST.map((name) => {
            const present = status?.env?.present?.includes(name) ?? false;
            return (
              <li key={name} className="flex items-center gap-2">
                <Dot ok={present} />
                <code className="text-xs">{name}</code>
                {!present ? <span className="text-[11px] text-muted">missing</span> : null}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Worklist */}
      <section className="card p-5">
        <h2 className="text-sm font-semibold">
          Figures we couldn&rsquo;t match to a live source yet
        </h2>
        <p className="mt-1 text-xs text-muted">
          Everything below currently renders from the 11 Jul 2026 dashboard
          snapshot (grey SNAPSHOT badges). Work through them one by one as
          access lands.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {WORKLIST.map((group) => (
            <div key={group.system}>
              <h3 className="text-[13px] font-semibold">{group.system}</h3>
              <ul className="mt-2 space-y-1.5 text-[13px] text-muted">
                {group.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
