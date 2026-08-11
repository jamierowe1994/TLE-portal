"use client";

// Admin tab: Arrears — summary, aging buckets, full tenant table.
// ADMIN ONLY: contains tenant personal data. It arrives via the seed prop
// (fetched from the session+ADMIN_EMAILS-gated /api/admin/seed route) — never
// import lib/seed-data.ts here, or the tenant data ships in the public bundle.
// PayProp-sourced (no API access yet) — PayProp arrears report 2026-07-06.

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import DataTable, { type DataTableColumn } from "@/components/DataTable";
import type { SeedData } from "@/lib/seed-data"; // type-only — erased at build
import type { ArrearsTenantRow } from "@/lib/seed-types";
import { formatDate, formatGBP, formatNum, monthLabel } from "@/lib/format";
import { liveMonth } from "@/lib/roster";

const COLUMNS: DataTableColumn<ArrearsTenantRow & Record<string, unknown>>[] = [
  { key: "tenant", label: "Tenant" },
  { key: "property", label: "Property" },
  { key: "region", label: "Region" },
  {
    key: "balance",
    label: "Balance",
    align: "right",
    render: (r) => <span className="font-semibold text-accent">{formatGBP(r.balance, true)}</span>,
  },
  { key: "status", label: "Status" },
  { key: "protection", label: "Protection" },
  { key: "lastInvoice", label: "Last invoice", align: "right", render: (r) => formatDate(r.lastInvoice) },
  { key: "lastPayment", label: "Last payment", align: "right", render: (r) => formatDate(r.lastPayment) },
  { key: "lastReminder", label: "Last reminder", align: "right", render: (r) => formatDate(r.lastReminder) },
];

interface LiveArrears {
  tenants: Array<{ tenant: string; property: string; owed: number; lastInvoice: string | null }>;
  totalOwed: number;
  checked: number;
  byAccount: Array<{ account: string; label: string; tenants: number; owed: number }>;
  largest: number;
  average: number;
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

export default function ArrearsTab({ month, seed }: { month: string; seed: SeedData }) {
  const a = seed.arrears;
  const s = a.summary;

  // PayProp gathers in the background, so poll until it lands rather than
  // sitting on the snapshot for the whole session.
  const [live, setLive] = useState<LiveArrears | null>(null);
  // Rent roll comes from the portfolio walk — needed for "% of rent roll".
  const [rentRoll, setRentRoll] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const ask = () => {
      fetch("/api/admin/payprop-live", { cache: "no-store" })
        .then((r) => r.json())
        .then(
          (d: {
            arrears?: LiveArrears | null;
            portfolio?: { totalRentRoll: number } | null;
          }) => {
            if (cancelled) return;
            if (d.arrears) setLive(d.arrears);
            if (d.portfolio) setRentRoll(d.portfolio.totalRentRoll);
            if ((!d.arrears || !d.portfolio) && tries++ < 40) setTimeout(ask, 5000);
          }
        )
        .catch(() => {});
    };
    ask();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Source + privacy banner */}
      {live ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
          <span className="font-semibold">
            Live from PayProp — as at today, {formatDate(new Date().toISOString())}.
          </span>{" "}
          {live.tenants.length} of {live.checked} tenancies in arrears, owing{" "}
          <span className="font-semibold">
            £{live.totalOwed.toLocaleString("en-GB", { maximumFractionDigits: 0 })}
          </span>
          .{" "}
          {month !== liveMonth() ? (
            <span className="font-semibold">
              This is NOT {monthLabel(month)} — PayProp reports a tenant&rsquo;s balance as it
              stands now and keeps no history of it, so the same figure appears under every
              month. Rebuilding a past month means recomputing what was due against what was
              paid, tenant by tenant, which is an accounting exercise rather than a query —
              and a wrong answer means chasing someone who doesn&rsquo;t owe.
            </span>
          ) : null}{" "}
          <span className="font-semibold">
            This view is admin-only — it contains tenant personal data.
          </span>
        </div>
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <span className="font-semibold">Fetching live arrears from PayProp…</span>{" "}
          Showing the 2026-07-06 snapshot until it lands.{" "}
          <span className="font-semibold">
            This view is admin-only — it contains tenant personal data.
          </span>
        </div>
      )}

      {/* This tab reads a STOCK, not a flow. PayProp and Rex both export
          current state and neither keeps a history, so "as it stood in June"
          cannot be rebuilt — only invented. The month selector above does not
          change these figures, and saying so is the whole point of this
          banner: the old wording implied they were a July capture, which made
          a live read look stale AND made a past month look answerable. */}
      {month !== liveMonth() ? (
        <div className="rounded-2xl border border-line bg-card px-4 py-3 text-[13px] text-muted">
          Everything below is <strong>as at today</strong>, not {monthLabel(month)}. These are
          current-state figures — neither PayProp nor Rex stores a history of them, so a past
          month can&apos;t be rebuilt. Live figures carry their own date; anything still on the
          snapshot is badged and dated 11 Jul 2026.
        </div>
      ) : null}

      {live ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Tenants in arrears
            </div>
            <div className="stat-value mt-1 text-[26px]">{live.tenants.length}</div>
            <div className="mt-0.5 text-[11px] text-muted">of {live.checked} tenancies</div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Total owed
            </div>
            <div className="stat-value mt-1 text-[26px]">
              £{live.totalOwed.toLocaleString("en-GB", { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Largest debt
            </div>
            <div className="stat-value mt-1 text-[26px]">
              £{(live.tenants[0]?.owed ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 0 })}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-muted">
              {live.tenants[0]?.tenant ?? "—"}
            </div>
          </div>
          <div className="card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Average debt
            </div>
            <div className="stat-value mt-1 text-[26px]">
              £
              {Math.round(
                live.tenants.length ? live.totalOwed / live.tenants.length : 0
              ).toLocaleString("en-GB")}
            </div>
          </div>
        </div>
      ) : null}

      {live ? (
        <section className="card p-5">
          <h2 className="text-sm font-semibold">Who&rsquo;s behind — live</h2>
          <div className="mt-3 space-y-1.5">
            {live.tenants.slice(0, 15).map((t, i) => (
              <div
                key={`${t.tenant}-${i}`}
                className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{t.tenant}</span>
                  <span className="block truncate text-[11px] text-muted">{t.property}</span>
                </span>
                <span className="shrink-0 text-[13px] font-semibold text-ink tnum">
                  £{t.owed.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
          {live.tenants.length > 15 ? (
            <p className="mt-2 text-[11px] text-muted">
              +{live.tenants.length - 15} more
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Summary cards — live where PayProp can answer, snapshot otherwise */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Tenants in arrears"
          stat={
            live
              ? { value: live.tenants.length, source: "live-payprop", note: `Of ${live.checked} tenancies across both agencies — live from PayProp.` }
              : s.totalInArrears
          }
          big
        />
        <StatCard
          label="Total arrears"
          stat={
            live
              ? { value: Math.round(live.totalOwed), display: gbp(live.totalOwed), source: "live-payprop", note: `Largest single debt ${gbp(live.largest)}; average ${gbp(live.average)}.` }
              : s.totalValue
          }
          big
        />
        {live
          ? live.byAccount.map((acc) => (
              <StatCard
                key={acc.account}
                label={acc.label}
                stat={{ value: acc.tenants, source: "live-payprop", note: `${gbp(acc.owed)} owed across ${acc.tenants} tenancies.` }}
                sub={gbp(acc.owed)}
              />
            ))
          : (
            <>
              <StatCard label="E&W" stat={s.eAndWCount} sub={s.eAndWValue.display} />
              <StatCard label="Glasgow" stat={s.glasgowCount} sub={s.glasgowValue.display} />
            </>
          )}
        <StatCard
          label="Protected (RLP/LEC)"
          stat={s.protectedCount}
          sub={`${s.protectedClaimable.display ?? "£0.00"} claimable — ${
            (s.totalInArrears.value ?? 0) - (s.protectedCount.value ?? 0)
          } unprotected`}
        />
        <StatCard
          label="% of rent roll"
          stat={
            live && rentRoll
              ? {
                  value: Math.round((live.totalOwed / rentRoll) * 1000) / 10,
                  display: `${((live.totalOwed / rentRoll) * 100).toFixed(1)}%`,
                  source: "live-payprop",
                  note: `${gbp(live.totalOwed)} owed against ${gbp(rentRoll)} of monthly rent under management.`,
                }
              : s.pctOfRentRoll
          }
          sub={
            live && rentRoll
              ? `${gbp(live.totalOwed)} of ${gbp(rentRoll)} rent roll`
              : `${s.totalValue.display ?? ""} of ${seed.portfolio.overview.rentRollTotal.display ?? "rent roll"}`
          }
        />
      </div>

      {/* Aging buckets */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Arrears aging</h2>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {a.aging.map((b) => (
            <div key={b.label} className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {b.label}
              </div>
              <div className="stat-value mt-1.5 text-[24px]">{formatNum(b.count)}</div>
              <div className="mt-0.5 text-xs text-muted tnum">
                {formatGBP(b.value, true)}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">{a.agingNote}</p>
      </section>

      {/* Tenant table */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          Tenants in arrears — {a.tenants.length} records
        </h2>
        <DataTable columns={COLUMNS} rows={a.tenants} compact />
        <p className="text-xs text-muted">{a.footer}</p>
      </section>
    </div>
  );
}
