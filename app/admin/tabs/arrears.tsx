"use client";

// Admin tab: Arrears — summary, aging buckets, full tenant table.
// ADMIN ONLY: contains tenant personal data. It arrives via the seed prop
// (fetched from the session+ADMIN_EMAILS-gated /api/admin/seed route) — never
// import lib/seed-data.ts here, or the tenant data ships in the public bundle.
// PayProp-sourced (no API access yet) — PayProp arrears report 2026-07-06.

import { useCallback, useEffect, useState } from "react";
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

/* ---------------------------- the arrears log ----------------------------
 * PayProp answers "what does this tenant owe right now" and keeps no history,
 * which is why the same 40 tenants appeared under September last year as under
 * today. Rebuilding the past from invoices minus payments was measured and
 * rejected (2 of 9 real cases found, 1 invented). So instead the portal keeps
 * its own log: every live read is captured once a day, and prior months are
 * loaded from PayProp's own exports. Nothing in here is inferred — every row
 * was a real balance on a real date.
 */
interface SnapshotPerson {
  tenant: string;
  property: string;
  owed: number;
  account?: string | null;
}
interface StoredSnapshot {
  asAt: string;
  source: "payprop-live" | "upload";
  note: string | null;
  totalOwed: number;
  checked: number | null;
  tenants: number;
  largest: number;
  average: number;
  people: SnapshotPerson[];
}
interface Spell {
  tenant: string;
  property: string;
  owed: number;
  since: string;
  seen: number;
  owedThen: number;
}
interface ArrearsLog {
  month: string;
  snapshot: StoredSnapshot | null;
  exact: boolean;
  spells: Spell[];
  thin: boolean;
  snapshots: string[];
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

const daysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));

export default function ArrearsTab({ month, seed }: { month: string; seed: SeedData }) {
  const a = seed.arrears;
  const s = a.summary;

  // PayProp gathers in the background, so poll until it lands rather than
  // sitting on the snapshot for the whole session.
  const [live, setLive] = useState<LiveArrears | null>(null);
  /** Rent collection per month — the honest month-scoped figure on this tab. */
  const [collection, setCollection] = useState<
    Array<{ month: string; rentCollected: number; propertiesPaying: number; tenantsPaying: number; avgPerProperty: number | null; incomplete: boolean }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/rent-collection?month=${encodeURIComponent(month)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { months?: typeof collection } | null) => {
        if (!cancelled && d?.months) setCollection(d.months);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [month]);
  // The log: what we hold for the selected month, and how long each
  // currently-behind tenant has been behind.
  const [log, setLog] = useState<ArrearsLog | null>(null);
  const loadLog = useCallback(() => {
    fetch(`/api/admin/arrears-history?month=${encodeURIComponent(month)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ArrearsLog | null) => {
        // Gated on the month so a slow answer can't land under another
        // month's heading.
        if (d && d.month === month) setLog(d);
      })
      .catch(() => {});
  }, [month]);
  useEffect(() => {
    loadLog();
  }, [loadLog]);

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

  // Once the live read lands, KEEP it. PayProp forgets a balance the moment it
  // changes, so a read that isn't stored is a month-by-month answer thrown
  // away. Once a day, then a no-op.
  const [captured, setCaptured] = useState(false);
  useEffect(() => {
    if (!live || captured) return;
    setCaptured(true);
    fetch("/api/admin/arrears-history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capture: true }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stored?: boolean } | null) => {
        if (d?.stored) loadLog();
      })
      .catch(() => {});
  }, [live, captured, loadLog]);

  /*
   * WHICH FIGURES THE FOUR BOXES SHOW.
   *
   * On the live month, today's PayProp read — it is the truth and it is newer
   * than anything stored. On any past month, the snapshot we hold from that
   * month, and nothing else: showing today's balances under "June" is what made
   * this tab report the same 40 tenants for every month of the year. When we
   * hold nothing for a past month we say so, because a blank is honest and a
   * borrowed figure is not.
   */
  const stored = log?.snapshot ?? null;
  const isLiveMonth = month === liveMonth();
  const panel =
    isLiveMonth && live
      ? {
          basis: "live" as const,
          asAt: new Date().toISOString().slice(0, 10),
          tenants: live.tenants.length,
          totalOwed: live.totalOwed,
          largest: live.largest,
          average: live.average,
          checked: live.checked as number | null,
          people: live.tenants.map((t) => ({ tenant: t.tenant, property: t.property, owed: t.owed })),
        }
      : stored
        ? {
            basis: "stored" as const,
            asAt: stored.asAt,
            tenants: stored.tenants,
            totalOwed: stored.totalOwed,
            largest: stored.largest,
            average: stored.average,
            checked: stored.checked,
            people: stored.people,
          }
        : null;
  const sinceOf = new Map((log?.spells ?? []).map((s) => [`${s.tenant}|${s.property}`, s]));

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

      {/* ------------------- rent collection, month by month -------------------
          The month-scoped half of this tab. Arrears itself cannot be rewound —
          a rebuild from invoices minus payments was measured against PayProp's
          own balances and agreed on only 2 of 9 real cases while inventing 1,
          so it was rejected. These are pure flows out of the payment rows:
          nothing inferred, and no individual can be wrongly named. */}
      {collection.length ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-sm font-semibold">Rent collection — month by month</h2>
            <span className="text-[11px] text-muted">
              Live from PayProp · what came in, from how many properties and tenants ·
              this DOES follow the month picker
            </span>
          </div>
          <DataTable
            columns={[
              { key: "month", label: "Month", render: (r) => monthLabel(String(r.month)) },
              {
                key: "rentCollected",
                label: "Rent collected",
                align: "right",
                render: (r) => `£${Number(r.rentCollected).toLocaleString("en-GB")}`,
              },
              { key: "propertiesPaying", label: "Properties paying", align: "right" },
              { key: "tenantsPaying", label: "Tenants paying", align: "right" },
              {
                key: "avgPerProperty",
                label: "Avg per property",
                align: "right",
                render: (r) =>
                  r.avgPerProperty == null
                    ? "—"
                    : `£${Number(r.avgPerProperty).toLocaleString("en-GB")}`,
              },
              {
                key: "incomplete",
                label: "",
                render: (r) =>
                  r.incomplete ? (
                    <span
                      className="text-[11px] font-semibold text-red-600"
                      title="An agency was unreachable when this month was computed, so these figures are short by a whole agency."
                    >
                      short
                    </span>
                  ) : (
                    ""
                  ),
              },
            ]}
            rows={collection as unknown as Record<string, unknown>[]}
            compact
          />
          <p className="text-[11px] text-muted">
            Counts what actually transacted each month, so it is lower than the book
            wherever a property took no payment. This is deliberately NOT an arrears
            figure: rebuilding arrears per month was tested against PayProp&rsquo;s own
            balances and missed 7 of 9 real cases while inventing 1, so it isn&rsquo;t
            shown. Arrears above stays a live, as-at-today read.
          </p>
        </section>
      ) : null}

      {/* ---------------- the four boxes, for the selected month ---------------- */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-sm font-semibold">
            {panel?.basis === "stored"
              ? `Arrears as at ${formatDate(panel.asAt)}`
              : "Arrears as at today"}
          </h2>
          <span className="text-[11px] text-muted">
            {panel?.basis === "stored" ? (
              <>
                from the arrears log ·{" "}
                {log?.exact
                  ? `stored ${monthLabel(month)}`
                  : `nearest we hold before the end of ${monthLabel(month)}`}
              </>
            ) : panel ? (
              "live from PayProp · kept, so this month is answerable next year"
            ) : (
              "nothing held for this month"
            )}
          </span>
        </div>
        {panel ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Tenants in arrears
              </div>
              <div className="stat-value mt-1 text-[26px]">{panel.tenants}</div>
              <div className="mt-0.5 text-[11px] text-muted">
                {panel.checked != null ? `of ${panel.checked} tenancies` : "denominator not in this export"}
              </div>
            </div>
            <div className="card p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Total owed
              </div>
              <div className="stat-value mt-1 text-[26px]">{gbp(panel.totalOwed)}</div>
            </div>
            <div className="card p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Largest debt
              </div>
              <div className="stat-value mt-1 text-[26px]">{gbp(panel.largest)}</div>
              <div className="mt-0.5 truncate text-[11px] text-muted">
                {panel.people[0]?.tenant ?? "—"}
              </div>
            </div>
            <div className="card p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Average debt
              </div>
              <div className="stat-value mt-1 text-[26px]">{gbp(panel.average)}</div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-card px-4 py-3 text-[13px] text-muted">
            <strong className="text-ink">Nothing held for {monthLabel(month)}.</strong> PayProp
            keeps no history of a balance, so a month can only be answered from a reading taken at
            the time. Today&rsquo;s is captured automatically from now on; for earlier months, paste
            the PayProp arrears export below and it becomes answerable permanently. Deliberately
            left blank rather than filled with today&rsquo;s figures.
          </div>
        )}
      </section>

      {/* Who's behind, and for how long — the question PayProp alone can't answer */}
      {panel ? (
        <section className="card p-5">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-sm font-semibold">Who&rsquo;s behind</h2>
            <span className="text-[11px] text-muted">
              {log && !log.thin
                ? `“Behind since” is the first of ${log.snapshots.length} readings in an unbroken run — a tenant who cleared and fell behind again starts afresh.`
                : "“Behind since” fills in once there are two readings — today is the first."}
            </span>
          </div>
          <div className="mt-3 space-y-1.5">
            {panel.people.slice(0, 15).map((t, i) => {
              const spell = sinceOf.get(`${t.tenant}|${t.property}`);
              const days = spell ? daysBetween(spell.since, panel.asAt) : 0;
              return (
                <div
                  key={`${t.tenant}-${i}`}
                  className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{t.tenant}</span>
                    <span className="block truncate text-[11px] text-muted">{t.property}</span>
                  </span>
                  {spell && days > 0 ? (
                    <span
                      className="shrink-0 text-[11px] text-muted"
                      title={`First seen in arrears on ${formatDate(spell.since)}, owing ${gbp(spell.owedThen)} then.`}
                    >
                      {days >= 60 ? `${Math.round(days / 30)} months` : `${days} days`}
                      {spell.owed > spell.owedThen ? " ↑" : spell.owed < spell.owedThen ? " ↓" : ""}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-[13px] font-semibold text-ink tnum">
                    £{t.owed.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              );
            })}
          </div>
          {panel.people.length > 15 ? (
            <p className="mt-2 text-[11px] text-muted">+{panel.people.length - 15} more</p>
          ) : null}
        </section>
      ) : null}

      <ArrearsImport snapshots={log?.snapshots ?? []} onSaved={loadLog} />

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

/* --------------------------- loading prior months --------------------------- */

interface Preview {
  asAt: string;
  columns: Record<string, string>;
  tenants: number;
  totalOwed: number;
  skipped: string[];
  owedIsNegative: boolean;
  credits: number;
  people: SnapshotPerson[];
}

/**
 * Paste a PayProp arrears export for a past date and keep it.
 *
 * Deliberately two steps. What lands here becomes the permanent record of who
 * owed what and when — the thing partners will be shown and tenants chased on
 * — so the parse is shown back BEFORE anything is written: which column was
 * read as the balance, how many rows, and every line the parser couldn't read.
 * A silently mis-mapped column would be indistinguishable from a good import.
 */
function ArrearsImport({
  snapshots,
  onSaved,
}: {
  snapshots: string[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [asAt, setAsAt] = useState("");
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const post = async (commit: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/arrears-history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ asAt, text, note, commit }),
      });
      const d = await res.json();
      if (!res.ok || d.error) {
        setError(d.error ?? "That didn't work.");
        return;
      }
      if (commit) {
        setSaved(`${d.tenants} tenants stored for ${asAt}, owing ${gbp(d.totalOwed)}.`);
        setPreview(null);
        setText("");
        onSaved();
      } else {
        setPreview(d as Preview);
      }
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-3 text-left"
      >
        <span>
          <span className="text-sm font-semibold">Load a past month&rsquo;s arrears</span>
          <span className="ml-2 text-[11px] text-muted">
            {snapshots.length
              ? `${snapshots.length} reading${snapshots.length === 1 ? "" : "s"} held · ${snapshots[0]} to ${snapshots[snapshots.length - 1]}`
              : "nothing held yet"}
          </span>
        </span>
        <span className="text-[11px] text-muted">{open ? "close" : "open"}</span>
      </button>

      {open ? (
        <div className="mt-4 space-y-3">
          <p className="text-[12px] text-muted">
            Paste a PayProp arrears export — straight out of a spreadsheet, or CSV. Columns are
            matched by their headings, so the order doesn&rsquo;t matter: it needs a{" "}
            <strong>tenant</strong> column and a <strong>balance</strong> column, and will use{" "}
            <strong>property</strong>, <strong>account</strong> and <strong>last payment</strong>{" "}
            if they&rsquo;re there. Balances are read as money owed whichever way round the export
            signs them, and anything square or in credit is dropped.
          </p>
          <div className="flex flex-wrap gap-3">
            <label className="text-[12px]">
              <span className="block text-muted">Date these balances were true</span>
              <input
                type="date"
                value={asAt}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setAsAt(e.target.value)}
                className="mt-1 rounded-xl border border-line bg-card px-3 py-1.5 text-[13px]"
              />
            </label>
            <label className="min-w-[220px] flex-1 text-[12px]">
              <span className="block text-muted">Where it came from (optional)</span>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. PayProp arrears report, both agencies"
                className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-1.5 text-[13px]"
              />
            </label>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder={"Tenant\tProperty\tBalance\nA Smith\t12 High St\t-1250.00"}
            className="w-full rounded-xl border border-line bg-card px-3 py-2 font-mono text-[12px]"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || !asAt || !text.trim()}
              onClick={() => post(false)}
              className="rounded-xl border border-line px-3.5 py-1.5 text-[13px] font-semibold disabled:opacity-40"
            >
              {busy ? "Reading…" : "Check it"}
            </button>
            {preview ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => post(true)}
                className="rounded-xl bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
              >
                Save {preview.tenants} tenants for {preview.asAt}
              </button>
            ) : null}
            {error ? <span className="text-[12px] font-semibold text-accent">{error}</span> : null}
            {saved ? <span className="text-[12px] font-semibold text-green-700">{saved}</span> : null}
          </div>

          {preview ? (
            <div className="rounded-2xl border border-line p-4 text-[12px]">
              <div className="font-semibold text-ink">
                Read {preview.tenants} tenants owing {gbp(preview.totalOwed)} — nothing saved yet.
              </div>
              <div className="mt-1 text-muted">
                Columns used:{" "}
                {Object.entries(preview.columns)
                  .map(([k, v]) => `${k} ← “${v}”`)
                  .join(" · ")}
              </div>
              {/* Which way up the file was read. Getting this backwards turns
                  tenants in credit into tenants in arrears, so it is stated
                  rather than assumed. */}
              <div className="mt-1 text-muted">
                Read as <strong>{preview.owedIsNegative ? "negative" : "positive"} = owed</strong>,
                from the majority of the rows.
                {preview.credits > 0 ? (
                  <>
                    {" "}
                    {preview.credits} row{preview.credits === 1 ? " was" : "s were"} on the other
                    side of zero and {preview.credits === 1 ? "was" : "were"} dropped as in credit
                    — if that looks wrong, the file is the other way up and this import should not
                    be saved.
                  </>
                ) : null}
              </div>
              {preview.skipped.length ? (
                <div className="mt-2 text-accent">
                  {preview.skipped.length} line{preview.skipped.length === 1 ? "" : "s"} couldn&rsquo;t
                  be read and would NOT be saved:
                  <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                    {preview.skipped.slice(0, 5).map((s, i) => (
                      <li key={i} className="truncate">
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-2 space-y-0.5">
                {preview.people.slice(0, 8).map((p, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span className="truncate text-muted">
                      {p.tenant} · {p.property}
                    </span>
                    <span className="shrink-0 tnum">£{p.owed.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
