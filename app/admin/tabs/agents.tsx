"use client";

// Admin · Agents tab — per-agent July MTD KPI table (seed, via the admin-gated
// /api/admin/seed fetch in the shell) merged with live portal-account links,
// the Partner Net Income YTD table, a row-click agent drill-down (forecast,
// ads link, portfolio, compliance), and the user management panel (link
// account ↔ agentKey / REX / Meta, reset password).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import DataTable from "@/components/DataTable";
import SourceBadge from "@/components/SourceBadge";
import StatCard from "@/components/StatCard";
import type { SeedData } from "@/lib/seed-data"; // type-only — erased at build
import { ROSTER, agentKeysForName } from "@/lib/roster";
import type { AgentForecast, UserProfile } from "@/lib/types";
import { formatDate, formatGBP, formatNum, formatPct, monthLabel } from "@/lib/format";

/* ------------------------------ helpers ------------------------------ */

function money(value: number | null | undefined): ReactNode {
  if (value == null || Number.isNaN(value)) return "—";
  if (value < 0) {
    return <span className="text-red-600">({formatGBP(Math.abs(value))})</span>;
  }
  return formatGBP(value);
}

const TIER_STYLES: Record<string, string> = {
  TOP: "border-green-200 bg-green-50 text-green-700",
  MID: "border-amber-200 bg-amber-50 text-amber-700",
  DEV: "border-gray-200 bg-gray-100 text-gray-600",
  NEW: "border-blue-200 bg-blue-50 text-blue-700",
  TOTAL: "border-line bg-card text-ink",
};

function TierChip({ tier }: { tier: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
        TIER_STYLES[tier] ?? TIER_STYLES.DEV
      }`}
    >
      {tier}
    </span>
  );
}

const TAG_STYLES: Record<string, string> = {
  NEW: "border-blue-200 bg-blue-50 text-blue-700",
  GLASGOW: "border-purple-200 bg-purple-50 text-purple-700",
  TLE: "border-red-200 bg-accent-soft text-accent",
};

function SectionTitle({
  children,
  source,
}: {
  children: ReactNode;
  source?: string;
}) {
  return (
    <div className="mb-3 mt-8 first:mt-0">
      <h2 className="text-sm font-semibold uppercase tracking-wide">{children}</h2>
      {source ? (
        <p className="mt-0.5 text-[11px] text-muted">Source: {source}</p>
      ) : null}
    </div>
  );
}

/* ------------------------- tolerant API parsing ------------------------- */

type AdminUser = UserProfile & { adminNotes?: { at: string; text: string }[] };

/** One row of GET /api/admin/forecasts — forecast nested under `forecast`. */
interface AdminForecastRow {
  agentKey: string;
  displayName: string;
  userLinked: boolean;
  forecast: AgentForecast | null;
}

function extractUsers(payload: unknown): AdminUser[] {
  if (Array.isArray(payload)) return payload as AdminUser[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.users)) return obj.users as AdminUser[];
  }
  return [];
}

function extractForecastRows(payload: unknown): AdminForecastRow[] {
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.rows)) return obj.rows as AdminForecastRow[];
  }
  return [];
}

/* ------------------------- user management row ------------------------- */

function UserRow({
  user,
  onSaved,
}: {
  user: AdminUser;
  onSaved: (updated: AdminUser) => void;
}) {
  const [agentKey, setAgentKey] = useState(user.agentKey ?? "");
  const [rexUserId, setRexUserId] = useState(user.rexUserId ?? "");
  const [metaCampaignId, setMetaCampaignId] = useState(user.metaCampaignId ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [linking, setLinking] = useState(false);

  // One click: probe REX for this agent's email, and assign the id we find.
  // The fallback for anyone signup couldn't auto-link (e.g. added to REX later).
  async function findInRex() {
    setLinking(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/rex-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = (await res.json()) as {
        linked?: boolean;
        rexUserId?: string;
        matchedBy?: "email" | "name";
        matchedEmail?: string;
        reason?: string;
        user?: AdminUser;
        error?: string;
      };
      if (data.linked && data.rexUserId) {
        setRexUserId(data.rexUserId);
        setMessage(
          data.matchedBy === "name"
            ? `Linked to REX ${data.rexUserId} by name — REX has them as ${data.matchedEmail}. Worth a check.`
            : `Linked to REX user ${data.rexUserId}.`
        );
        if (data.user) onSaved(data.user);
      } else {
        setMessage(data.reason ?? data.error ?? "Couldn't find them in REX.");
      }
    } catch {
      setMessage("Couldn't reach REX just now.");
    } finally {
      setLinking(false);
    }
  }

  const dirty =
    agentKey !== (user.agentKey ?? "") ||
    rexUserId !== (user.rexUserId ?? "") ||
    metaCampaignId !== (user.metaCampaignId ?? "");

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          agentKey: agentKey || null,
          rexUserId: rexUserId || null,
          metaCampaignId: metaCampaignId || null,
        }),
      });
      const data = (await res.json()) as { user?: AdminUser; error?: string };
      if (!res.ok || !data.user) {
        setMessage(data.error ?? "Couldn't save changes.");
      } else {
        setMessage("Saved.");
        onSaved(data.user);
      }
    } catch {
      setMessage("Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Reset ${user.name}'s password? Their current password stops working immediately.`
      )
    ) {
      return;
    }
    setResetting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = (await res.json()) as { tempPassword?: string; error?: string };
      if (!res.ok || !data.tempPassword) {
        setMessage(data.error ?? "Couldn't reset the password.");
      } else {
        setTempPassword(data.tempPassword);
      }
    } catch {
      setMessage("Couldn't reset the password.");
    } finally {
      setResetting(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] outline-none focus:border-accent";

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-semibold">{user.name}</span>
          <span className="ml-2 text-xs text-muted">{user.email}</span>
          {user.isAdmin ? (
            <span className="ml-2 inline-flex rounded-full border border-red-200 bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">
              ADMIN
            </span>
          ) : null}
        </div>
        <span className="text-[11px] text-muted">
          Joined {formatDate(user.createdAt)}
        </span>
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
            Agent (roster link)
          </span>
          <select
            className={inputClass}
            value={agentKey}
            onChange={(e) => setAgentKey(e.target.value)}
          >
            <option value="">— Not linked —</option>
            {ROSTER.map((r) => (
              <option key={r.agentKey} value={r.agentKey}>
                {r.displayName}
                {r.active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
            REX user id
          </span>
          <div className="flex items-center gap-2">
            <input
              className={inputClass}
              value={rexUserId}
              onChange={(e) => setRexUserId(e.target.value)}
              placeholder="AccountUsers id"
            />
            <button
              type="button"
              onClick={() => void findInRex()}
              disabled={linking}
              title={`Search REX for ${user.email} and assign their id`}
              className="btn-press shrink-0 rounded-lg border border-line bg-card px-2.5 py-2 text-[12px] font-medium text-muted transition hover:text-ink disabled:opacity-50"
            >
              {linking ? "Finding…" : "Find in REX"}
            </button>
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
            Meta campaign id(s)
          </span>
          <input
            className={inputClass}
            value={metaCampaignId}
            onChange={(e) => setMetaCampaignId(e.target.value)}
            placeholder="Campaign id — comma-separate for several"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="btn-press rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => void resetPassword()}
          disabled={resetting}
          className="btn-press rounded-lg border border-line bg-card px-3.5 py-1.5 text-[13px] font-medium disabled:opacity-40"
        >
          {resetting ? "Resetting…" : "Reset password"}
        </button>
        {message ? <span className="text-xs text-muted">{message}</span> : null}
      </div>

      {tempPassword ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
          Temporary password:{" "}
          <code className="tnum font-semibold">{tempPassword}</code> — shown
          once, pass it to {user.name} and ask them to change it in their
          profile.
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------- tab --------------------------------- */

interface LivePayload {
  month: string;
  linkedCount: number;
  totalAgents: number;
  totals: { marketAppraisals: number; listings: number; pipeline: number; managed: number; rentRoll: number };
}

export default function Agents({ month, seed }: { month: string; seed: SeedData }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [forecastRows, setForecastRows] = useState<AdminForecastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [live, setLive] = useState<LivePayload | null>(null);
  const [liveLoading, setLiveLoading] = useState(true);
  // Each partner's managed book and commission, live from PayProp.
  const [book, setBook] = useState<{
    byAgent: Record<string, { names: string[]; properties: number; rentRoll: number; activeTenancies: number }>;
  } | null>(null);
  const [earnings, setEarnings] = useState<Array<{ name: string; amount: number; payments: number }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const ask = () => {
      fetch(`/api/admin/payprop-live?month=${encodeURIComponent(month)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { portfolio?: { byAgent: Record<string, { names: string[]; properties: number; rentRoll: number; activeTenancies: number }> } | null; income?: { byPartner?: Array<{ name: string; amount: number; payments: number }> } | null }) => {
          if (cancelled) return;
          if (d.portfolio) setBook(d.portfolio);
          if (d.income?.byPartner) setEarnings(d.income.byPartner);
          if ((!d.portfolio || !d.income) && tries++ < 40) setTimeout(ask, 5000);
        })
        .catch(() => {});
    };
    ask();
    return () => {
      cancelled = true;
    };
  }, [month]);

  // Live REX totals across linked agents — separate from the fast seed render
  // because it fans out several REX calls (cached server-side for 3 min).
  useEffect(() => {
    let cancelled = false;
    setLiveLoading(true);
    fetch(`/api/admin/live-funnel?month=${encodeURIComponent(month)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setLive(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLiveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [uRes, fRes] = await Promise.all([
        fetch("/api/admin/users", { cache: "no-store" }),
        fetch(`/api/admin/forecasts?month=${encodeURIComponent(month)}`, { cache: "no-store" }),
      ]);
      if (uRes.ok) setUsers(extractUsers(await uRes.json()));
      else setError("Couldn't load portal accounts.");
      if (fRes.ok) setForecastRows(extractForecastRows(await fRes.json()));
    } catch {
      setError("Couldn't load portal accounts.");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const usersByAgentKey = useMemo(() => {
    const map = new Map<string, AdminUser>();
    for (const u of users) if (u.agentKey) map.set(u.agentKey, u);
    return map;
  }, [users]);

  // agentKey → that agent's self-set forecast for the month (where one exists).
  const forecastByAgentKey = useMemo(() => {
    const map = new Map<string, AgentForecast>();
    for (const r of forecastRows) {
      if (r.forecast) map.set(r.agentKey, r.forecast);
    }
    return map;
  }, [forecastRows]);

  /** Portal account (if any) for a verbatim KPI-table agent name. */
  function linkedUserForName(name: string): AdminUser | null {
    for (const key of agentKeysForName(name)) {
      const user = usersByAgentKey.get(key);
      if (user) return user;
    }
    return null;
  }

  /** Forecast (if any) for a verbatim KPI-table agent name. */
  function forecastForName(name: string): AgentForecast | null {
    for (const key of agentKeysForName(name)) {
      const f = forecastByAgentKey.get(key);
      if (f) return f;
    }
    return null;
  }

  const kpiRows = [...seed.agentKpisJulyMtd.rows, seed.agentKpisJulyMtd.totals].map(
    (row) => {
      const linked = row.tier === "TOTAL" ? null : linkedUserForName(row.agent);
      const forecast = row.tier === "TOTAL" ? null : forecastForName(row.agent);
      return {
        tier: row.tier,
        agent: row.tier === "TOTAL" ? "TOTAL" : row.agent,
        portal: linked
          ? forecast?.gciTarget != null
            ? `Linked · forecast ${formatGBP(forecast.gciTarget)}`
            : "Linked"
          : row.tier === "TOTAL"
            ? ""
            : "No portal account",
        isLinked: !!linked,
        gci: row.gci,
        ma: row.ma,
        li: row.li,
        vw: row.vw,
        ap: row.ap,
        mi: row.mi,
        pn: row.pn,
      };
    }
  );

  const netIncomeRows = [
    ...seed.partnerNetIncome.rows,
    seed.partnerNetIncome.eAndWTotal,
  ];

  const unlinkedRoster = ROSTER.filter(
    (r) => r.active && !usersByAgentKey.has(r.agentKey)
  );

  const num = (v: unknown) => formatNum(v as number | null);

  const liveCards = live
    ? [
        { label: "Market appraisals", value: formatNum(live.totals.marketAppraisals), sub: monthLabel(month) },
        { label: "On-market listings", value: formatNum(live.totals.listings), sub: "Currently listed" },
        { label: "Pipeline", value: formatNum(live.totals.pipeline), sub: "Let agreed" },
        { label: "Managed properties", value: formatNum(live.totals.managed), sub: "Let & managed" },
        { label: "Rent roll / month", value: formatGBP(live.totals.rentRoll), sub: "Under management" },
      ]
    : [];

  return (
    <div>
      {/* ----------------------- live REX totals ----------------------- */}
      {/* ---- live from PayProp: each partner's book and commission ---- */}
      {book ? (
        <>
          <SectionTitle>Live from PayProp</SectionTitle>
          <div className="card mb-6 p-5">
            <p className="text-[12.5px] text-muted">
              Managed properties and rent under management come from PayProp&rsquo;s
              own responsible-agent field; commission is what each partner was
              actually paid this month.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="pb-2 font-semibold">Partner</th>
                    <th className="pb-2 text-right font-semibold">Properties</th>
                    <th className="pb-2 text-right font-semibold">Tenancies</th>
                    <th className="pb-2 text-right font-semibold">Rent / month</th>
                    <th className="pb-2 text-right font-semibold">Earned this month</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(book.byAgent)
                    .sort((a, b) => b.properties - a.properties)
                    .map((a) => {
                      const label = a.names.join(" / ");
                      // Commission is keyed by the beneficiary name PayProp
                      // pays, which may differ from the property's agent name.
                      const paid = (earnings ?? []).find((e) =>
                        a.names.some(
                          (n) => n.toLowerCase().trim() === e.name.toLowerCase().trim()
                        )
                      );
                      return (
                        <tr key={label} className="border-t border-line">
                          <td className="py-2">{label}</td>
                          <td className="py-2 text-right tnum">{a.properties}</td>
                          <td className="py-2 text-right tnum">{a.activeTenancies}</td>
                          <td className="py-2 text-right tnum">
                            £{Math.round(a.rentRoll).toLocaleString("en-GB")}
                          </td>
                          <td className="py-2 text-right tnum">
                            {paid
                              ? `£${Math.round(paid.amount).toLocaleString("en-GB")}`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      <SectionTitle>Live from REX</SectionTitle>
      {liveLoading && !live ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card h-24 animate-pulse" />
          ))}
        </div>
      ) : live && live.linkedCount > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {liveCards.map((c) => (
              <div key={c.label} className="card relative p-4">
                <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-1.5 py-0.5 text-[9px] font-semibold text-green-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> LIVE
                </span>
                <div className="stat-label pr-12 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {c.label}
                </div>
                <div className="stat-value mt-2 text-[24px]">{c.value}</div>
                <div className="mt-1 text-[11px] text-muted">{c.sub}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Live from REX across{" "}
            <span className="font-semibold text-ink">
              {live.linkedCount} of {live.totalAgents}
            </span>{" "}
            agents linked to a REX id. Link more accounts below to grow the live figures.
          </p>
        </>
      ) : (
        <p className="rounded-xl border border-line bg-card px-4 py-3 text-[13px] text-muted">
          No agents are linked to a REX id yet. Set an agent&rsquo;s REX id in the accounts below and
          their live appraisals, listings, pipeline and portfolio will roll up here.
        </p>
      )}

      {/* ----------------------- per-agent KPI table ----------------------- */}
      <SectionTitle source={seed.agentKpisJulyMtd.source}>
        Per-Agent KPIs — July MTD
      </SectionTitle>
      <p className="mb-2 text-xs text-muted">
        Click an agent&rsquo;s row to open their drill-down (forecast, ads,
        portfolio, compliance).
      </p>
      {error ? (
        <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          {error}
        </p>
      ) : null}
      <DataTable
        columns={[
          {
            key: "tier",
            label: "Tier",
            render: (row) => <TierChip tier={String(row.tier)} />,
          },
          { key: "agent", label: "Agent" },
          {
            key: "portal",
            label: "Portal account",
            render: (row) =>
              row.portal ? (
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    row.isLinked
                      ? "border-green-200 bg-green-50 text-green-700"
                      : "border-gray-200 bg-gray-100 text-gray-500"
                  }`}
                >
                  {String(row.portal)}
                </span>
              ) : (
                ""
              ),
          },
          { key: "gci", label: "GCI", align: "right", render: (row) => money(row.gci as number | null) },
          { key: "ma", label: "MA", align: "right", render: (row) => num(row.ma) },
          { key: "li", label: "Li", align: "right", render: (row) => num(row.li) },
          { key: "vw", label: "Vw", align: "right", render: (row) => num(row.vw) },
          { key: "ap", label: "Ap", align: "right", render: (row) => num(row.ap) },
          { key: "mi", label: "MI", align: "right", render: (row) => num(row.mi) },
          { key: "pn", label: "Pn", align: "right", render: (row) => num(row.pn) },
        ]}
        rows={kpiRows as unknown as Record<string, unknown>[]}
        compact
        onRowClick={(row) => {
          const name = String(row.agent);
          if (name !== "TOTAL") setSelectedAgent(name);
        }}
      />
      <p className="mt-2 flex items-center gap-2 text-[11px] text-muted">
        <SourceBadge source="snapshot" asOf="2026-07-11" />
        MA = market appraisals · Li = listings · Vw = viewings · Ap =
        applications · MI = move-ins · Pn = pipeline. Viewings total 28 here vs
        46 on the KPI Overview funnel — different report cuts on the source
        dashboard.
      </p>

      {/* ------------------------- agent drill-down ------------------------- */}
      {selectedAgent ? (
        <AgentDrilldown
          name={selectedAgent}
          month={month}
          seed={seed}
          user={linkedUserForName(selectedAgent)}
          forecast={forecastForName(selectedAgent)}
          onClose={() => setSelectedAgent(null)}
        />
      ) : null}

      {/* --------------------- partner net income YTD --------------------- */}
      <SectionTitle source={seed.partnerNetIncome.source}>
        Partner Net Income — YTD 2026
      </SectionTitle>
      <DataTable
        columns={[
          {
            key: "agent",
            label: "Agent",
            render: (row) => (
              <span className={row.agent === "E&W Total" ? "font-semibold" : ""}>
                {String(row.agent)}
                {row.tag ? (
                  <span
                    className={`ml-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      TAG_STYLES[String(row.tag)] ?? TAG_STYLES.NEW
                    }`}
                  >
                    {String(row.tag)}
                  </span>
                ) : null}
                {row.agent === "Sean Mc Mahon (Glasgow)" ? " †" : ""}
              </span>
            ),
          },
          { key: "jan", label: "Jan", align: "right", render: (row) => money(row.jan as number | null) },
          { key: "feb", label: "Feb", align: "right", render: (row) => money(row.feb as number | null) },
          { key: "mar", label: "Mar", align: "right", render: (row) => money(row.mar as number | null) },
          { key: "apr", label: "Apr", align: "right", render: (row) => money(row.apr as number | null) },
          { key: "may", label: "May", align: "right", render: (row) => money(row.may as number | null) },
          { key: "jun", label: "Jun", align: "right", render: (row) => money(row.jun as number | null) },
          {
            key: "ytdTotal",
            label: "YTD Total",
            align: "right",
            render: (row) => (
              <span className="font-semibold">{money(row.ytdTotal as number)}</span>
            ),
          },
        ]}
        rows={netIncomeRows as unknown as Record<string, unknown>[]}
        compact
        onRowClick={(row) => {
          const name = String(row.agent);
          if (name !== "E&W Total" && name !== "TOTAL") setSelectedAgent(name);
        }}
      />
      <p className="mt-2 text-[11px] text-muted">{seed.partnerNetIncome.glasgowNote}</p>

      {/* ------------------------- user management ------------------------- */}
      <SectionTitle>Portal accounts — link & manage</SectionTitle>
      <p className="mb-3 text-xs text-muted">
        Link each portal account to its roster agent so their dashboard picks
        up the right seed stats, REX user and Meta campaign. Figures on this
        page come from the dashboard snapshot until those links go live.
      </p>

      {loading ? (
        <p className="text-sm text-muted">Loading portal accounts…</p>
      ) : users.length === 0 ? (
        <div className="card p-5 text-sm text-muted">
          No portal accounts yet — agents create their own via Sign up on the
          landing page.
        </div>
      ) : (
        <div className="grid gap-3">
          {users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              onSaved={(updated) =>
                setUsers((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
              }
            />
          ))}
        </div>
      )}

      {unlinkedRoster.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Roster agents with no linked portal account ({unlinkedRoster.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {unlinkedRoster.map((r) => (
              <span
                key={r.agentKey}
                className="inline-flex rounded-full border border-line bg-card px-2.5 py-1 text-[11px] text-muted"
                title={`agentKey: ${r.agentKey} · ${r.region} · ${r.partnerType}`}
              >
                {r.displayName}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ drill-down ------------------------------ */

/** Snapshot StatValue wrapper for seed figures shown in the drill-down. */
function snapStat(
  value: number | null,
  display?: string,
  note?: string
): { value: number | null; display?: string; source: "snapshot"; note?: string; asOf: string } {
  return { value, display, source: "snapshot", note, asOf: "2026-07-11" };
}

function AgentDrilldown({
  name,
  month,
  seed,
  user,
  forecast,
  onClose,
}: {
  name: string;
  month: string;
  seed: SeedData;
  user: (UserProfile & { adminNotes?: { at: string; text: string }[] }) | null;
  forecast: AgentForecast | null;
  onClose: () => void;
}) {
  const keys = agentKeysForName(name);
  const matches = (rowName: string) =>
    agentKeysForName(rowName).some((k) => keys.includes(k));

  const roster = ROSTER.filter((r) => keys.includes(r.agentKey));
  const kpi = seed.agentKpisJulyMtd.rows.find((r) => matches(r.agent)) ?? null;
  const netIncome = seed.partnerNetIncome.rows.find((r) => matches(r.agent)) ?? null;
  const portfolio = seed.portfolio.byPartner.find((r) => matches(r.agent)) ?? null;
  const compliance = seed.compliance.byAgent.find((r) => matches(r.agent)) ?? null;
  const moveIns = seed.moveInsJuly.rows.filter((r) => matches(r.agent));
  const pipeline = [...seed.julyPipeline, ...seed.forwardPipeline].filter((r) =>
    matches(r.agent)
  );

  return (
    <section className="card mt-6 border-accent/30 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{name} — drill-down</h3>
          <p className="mt-0.5 text-xs text-muted">
            {roster.length > 0
              ? roster
                  .map((r) => `${r.displayName} · ${r.region} · ${r.partnerType}`)
                  .join("  |  ")
              : "Not matched to a roster agent."}
            {user ? ` · Portal account: ${user.email}` : " · No portal account linked."}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn-press rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium"
        >
          Close
        </button>
      </div>

      {/* Forecast */}
      <h4 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Forecast — {monthLabel(month)} (self-set in the portal)
      </h4>
      {forecast ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="GCI target"
            stat={{
              value: forecast.gciTarget,
              display: formatGBP(forecast.gciTarget),
              source: "manual",
              note: "Agent-set forecast from the portal forecast store",
            }}
          />
          <StatCard
            label="Move-ins target"
            stat={{ value: forecast.moveInsTarget, source: "manual" }}
          />
          <StatCard
            label="MAs target"
            stat={{ value: forecast.maTarget, source: "manual" }}
          />
          <div className="card p-4 text-xs text-muted">
            {forecast.notes ? `“${forecast.notes}”` : "No notes."}
            <div className="mt-1.5">Updated {formatDate(forecast.updatedAt)}</div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">
          No forecast set for {monthLabel(month)}
          {user ? "" : " — no portal account is linked to this agent yet"}.
        </p>
      )}

      {/* July KPIs */}
      <h4 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">
        July MTD KPIs (snapshot)
      </h4>
      {kpi ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          <StatCard label="GCI" stat={snapStat(kpi.gci, formatGBP(kpi.gci))} />
          <StatCard label="MAs" stat={snapStat(kpi.ma)} />
          <StatCard label="Listings" stat={snapStat(kpi.li)} />
          <StatCard label="Viewings" stat={snapStat(kpi.vw)} />
          <StatCard label="Applications" stat={snapStat(kpi.ap)} />
          <StatCard label="Move-ins" stat={snapStat(kpi.mi)} />
          <StatCard label="Pipeline" stat={snapStat(kpi.pn)} />
        </div>
      ) : (
        <p className="text-xs text-muted">
          Not in the July MTD Agent Detail table (no activity recorded).
        </p>
      )}

      {/* Ads / income / portfolio / compliance */}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Meta ads
          </h4>
          <div className="card p-4 text-xs">
            {user?.metaCampaignId ? (
              <>
                <span className="inline-flex rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                  Campaign linked
                </span>
                <span className="ml-2 tnum">{user.metaCampaignId}</span>
                <p className="mt-1.5 text-muted">
                  Live spend / leads / CPL render on the agent&rsquo;s own
                  dashboard (Ads page) via the Meta Graph API.
                </p>
              </>
            ) : (
              <p className="text-muted">
                No Meta campaign linked{user ? "" : " (no portal account)"} —
                link one in the portal accounts panel below to light up their
                live ads stats.
              </p>
            )}
          </div>
          <h4 className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Net income & activity
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Net income YTD"
              stat={snapStat(
                netIncome ? netIncome.ytdTotal : null,
                netIncome ? formatGBP(netIncome.ytdTotal) : undefined,
                seed.partnerNetIncome.source
              )}
            />
            <StatCard
              label="July move-ins / pipeline"
              stat={snapStat(moveIns.length, `${moveIns.length} / ${pipeline.length}`)}
              sub={`${moveIns.length} completed · ${pipeline.length} in pipeline`}
            />
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Portfolio (PayProp snapshot)
          </h4>
          {portfolio ? (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Managed" stat={snapStat(portfolio.managed)} />
              <StatCard label="Let only" stat={snapStat(portfolio.letOnly)} />
              <StatCard label="Total properties" stat={snapStat(portfolio.total)} />
              <StatCard
                label="Rent roll"
                stat={snapStat(
                  portfolio.rentRoll,
                  portfolio.rentRoll != null ? formatGBP(portfolio.rentRoll) : undefined
                )}
              />
            </div>
          ) : (
            <p className="text-xs text-muted">Not in the portfolio-by-partner table.</p>
          )}
          <h4 className="mb-2 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Compliance (REX PM snapshot)
          </h4>
          {compliance ? (
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Items" stat={snapStat(compliance.total)} />
              <StatCard
                label="Overdue"
                stat={snapStat(compliance.overdue)}
                sub={formatPct(compliance.pctOverdue)}
              />
              <StatCard label="Upcoming" stat={snapStat(compliance.upcoming)} />
            </div>
          ) : (
            <p className="text-xs text-muted">
              No compliance items recorded against this agent.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
