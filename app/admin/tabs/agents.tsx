"use client";

// Admin · Agents tab — per-agent July MTD KPI table (SEED) merged with live
// portal-account links, the Partner Net Income YTD table, and the user
// management panel (link account ↔ agentKey / REX / Meta, reset password).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import DataTable from "@/components/DataTable";
import SourceBadge from "@/components/SourceBadge";
import { SEED, ROSTER, agentKeysForName } from "@/lib/seed-data";
import type { AgentForecast, UserProfile } from "@/lib/types";
import { formatDate, formatGBP, formatNum } from "@/lib/format";

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
type ForecastRow = AgentForecast & { user?: Partial<UserProfile> };

function extractUsers(payload: unknown): AdminUser[] {
  if (Array.isArray(payload)) return payload as AdminUser[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.users)) return obj.users as AdminUser[];
  }
  return [];
}

function extractForecasts(payload: unknown): ForecastRow[] {
  if (Array.isArray(payload)) return payload as ForecastRow[];
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["forecasts", "rows", "items"]) {
      if (Array.isArray(obj[key])) return obj[key] as ForecastRow[];
    }
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
          <input
            className={inputClass}
            value={rexUserId}
            onChange={(e) => setRexUserId(e.target.value)}
            placeholder="AccountUsers id"
          />
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

export default function Agents({ month }: { month: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [forecasts, setForecasts] = useState<ForecastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      if (fRes.ok) setForecasts(extractForecasts(await fRes.json()));
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

  const forecastByUserId = useMemo(() => {
    const map = new Map<string, ForecastRow>();
    for (const f of forecasts) map.set(f.userId, f);
    return map;
  }, [forecasts]);

  /** Portal account (if any) for a verbatim KPI-table agent name. */
  function linkedUserForName(name: string): AdminUser | null {
    for (const key of agentKeysForName(name)) {
      const user = usersByAgentKey.get(key);
      if (user) return user;
    }
    return null;
  }

  const kpiRows = [...SEED.agentKpisJulyMtd.rows, SEED.agentKpisJulyMtd.totals].map(
    (row) => {
      const linked = row.tier === "TOTAL" ? null : linkedUserForName(row.agent);
      const forecast = linked ? forecastByUserId.get(linked.id) : undefined;
      return {
        tier: row.tier,
        agent: row.tier === "TOTAL" ? "TOTAL" : row.agent,
        portal: linked
          ? forecast
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
    ...SEED.partnerNetIncome.rows,
    SEED.partnerNetIncome.eAndWTotal,
  ];

  const unlinkedRoster = ROSTER.filter(
    (r) => r.active && !usersByAgentKey.has(r.agentKey)
  );

  const num = (v: unknown) => formatNum(v as number | null);

  return (
    <div>
      {/* ----------------------- per-agent KPI table ----------------------- */}
      <SectionTitle source={SEED.agentKpisJulyMtd.source}>
        Per-Agent KPIs — July MTD
      </SectionTitle>
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
      />
      <p className="mt-2 flex items-center gap-2 text-[11px] text-muted">
        <SourceBadge source="snapshot" asOf="2026-07-11" />
        MA = market appraisals · Li = listings · Vw = viewings · Ap =
        applications · MI = move-ins · Pn = pipeline. Viewings total 28 here vs
        46 on the KPI Overview funnel — different report cuts on the source
        dashboard.
      </p>

      {/* --------------------- partner net income YTD --------------------- */}
      <SectionTitle source={SEED.partnerNetIncome.source}>
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
      />
      <p className="mt-2 text-[11px] text-muted">{SEED.partnerNetIncome.glasgowNote}</p>

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
