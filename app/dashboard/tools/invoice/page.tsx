"use client";

// The invoicing tool. Three things in order: who you are, what you're
// invoicing for, and the document itself.
//
// Two rules shape it. Every figure is EDITABLE — the fee split is a default
// (70%) that nobody has documented per partner yet, so the tool suggests and
// the agent decides. And the invoice is branded to THEIR business, never to
// The Lettings Expert: they are invoicing the agency, so the agency's name on
// the letterhead would be exactly backwards.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DoodleIcon from "@/components/DoodleIcon";
import SaveButton from "@/components/SaveButton";
import Loader from "@/components/Loader";
import { formatGBP } from "@/lib/format";

interface Profile {
  businessName: string;
  address: string;
  email: string;
  phone: string;
  vatNumber: string;
  bankDetails: string;
  feePercent: number;
  nextNumber: number;
}

interface FeeLine {
  property: string;
  propertyId: string;
  category: string;
  gross: number;
  net: number;
  settledOn: string;
}

interface Row {
  id: string;
  description: string;
  amount: number;
}

const money = (n: number) => formatGBP(Math.round(n * 100) / 100);
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

function lastMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

const field =
  "w-full rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] outline-none transition focus:border-black/30";

export default function InvoicePage() {
  const months = useMemo(() => lastMonths(12), []);
  const [month, setMonth] = useState(months[0]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lines, setLines] = useState<FeeLine[] | null | undefined>(undefined);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Row[]>([]);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [issuedOn, setIssuedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/my/invoice?month=${m}`, { cache: "no-store" });
      const d = (await res.json()) as { profile: Profile; lines: FeeLine[] | null };
      setProfile(d.profile);
      setLines(d.lines);
      setInvoiceNo((prev) => prev || `INV-${String(d.profile.nextNumber).padStart(4, "0")}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
    // Picks belong to a month — carrying them across would invoice the wrong
    // fees under the right heading.
    setPicked(new Set());
  }, [month, load]);

  const pct = profile?.feePercent ?? 70;

  // Picked PayProp lines become rows at the agent's share; manual rows sit
  // alongside them and are never overwritten by a re-pick.
  const feeRows: Row[] = useMemo(
    () =>
      (lines ?? [])
        .filter((l) => picked.has(l.propertyId + l.settledOn + l.gross))
        .map((l) => ({
          id: l.propertyId + l.settledOn + l.gross,
          description: `${l.category} — ${l.property} (${l.settledOn})`,
          amount: Math.round(l.net * (pct / 100) * 100) / 100,
        })),
    [lines, picked, pct]
  );

  const allRows = [...feeRows, ...rows];
  const total = allRows.reduce((t, r) => t + (Number(r.amount) || 0), 0);

  async function saveProfile(): Promise<boolean> {
    if (!profile) return false;
    const res = await fetch("/api/my/invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile }),
    });
    if (!res.ok) return false;
    const d = (await res.json()) as { profile: Profile };
    setProfile(d.profile);
    return true;
  }

  function download(kind: "pdf" | "doc") {
    const html = invoiceHtml({
      profile: profile!,
      invoiceNo,
      issuedOn,
      rows: allRows,
      total,
      notes,
      month,
    });
    if (kind === "pdf") {
      // The browser's own print-to-PDF: it renders exactly what is on screen,
      // handles pagination, and needs no PDF library shipped to the client.
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
      return;
    }
    // Word opens HTML with this MIME type and keeps the layout.
    const blob = new Blob([html], { type: "application/msword" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${invoiceNo || "invoice"}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (loading && !profile) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader />
      </div>
    );
  }
  if (!profile) return null;

  const set = (patch: Partial<Profile>) => setProfile({ ...profile, ...patch });

  return (
    <div className="space-y-6">
      <div className="pt-2">
        <Link
          href="/dashboard/tools"
          className="text-[12px] text-muted transition hover:text-ink"
        >
          ← Tools
        </Link>
        <h1
          className="mt-1 tracking-tight"
          style={{ fontSize: "clamp(32px, 3.6vw, 46px)", lineHeight: 1.05, fontWeight: 500 }}
        >
          Invoicing
        </h1>
        <p className="mt-2.5 text-[13px] text-muted">
          Your fees, in your business&apos;s name — ready to send to accounts.
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-3">
        {/* ---------------- left: build the invoice ---------------- */}
        <div className="space-y-5 lg:col-span-2">
          <section className="card card-flat space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
                Fees settled in
              </h2>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="rounded-lg border border-line bg-transparent px-3 py-1.5 text-[13px] outline-none"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
              <span className="ml-auto text-[12px] text-muted">
                Your share: {pct}%
              </span>
            </div>

            {lines === null ? (
              <p className="text-[13px] text-muted">
                Couldn&apos;t reach PayProp just now, so no fees are listed. You
                can still add lines by hand below.
              </p>
            ) : lines && lines.length ? (
              <div className="space-y-2">
                {lines.map((l) => {
                  const key = l.propertyId + l.settledOn + l.gross;
                  const on = picked.has(key);
                  return (
                    <label
                      key={key}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
                        on ? "border-black/30" : "border-line hover:border-black/20"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(key);
                          else next.delete(key);
                          setPicked(next);
                        }}
                        className="h-4 w-4 rounded border-line accent-[#E31F36]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">
                          {l.property}
                        </span>
                        <span className="block truncate text-[11.5px] text-muted">
                          {l.category} · settled {l.settledOn}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[13px] font-semibold">
                          {money(l.net * (pct / 100))}
                        </span>
                        <span className="block text-[11px] text-muted">
                          {pct}% of {money(l.net)}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13px] text-muted">
                No fees settled in {monthLabel(month)}. Pick another month, or
                add the lines yourself below.
              </p>
            )}
          </section>

          {/* Manual lines — the tool suggests, it never insists. */}
          <section className="card card-flat space-y-3 p-5">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
              Your own lines
            </h2>
            {rows.map((r, i) => (
              <div key={r.id} className="flex items-center gap-2">
                <input
                  value={r.description}
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))
                  }
                  placeholder="What it's for"
                  className={field}
                />
                <input
                  value={r.amount || ""}
                  onChange={(e) =>
                    setRows(
                      rows.map((x, j) =>
                        j === i ? { ...x, amount: Number(e.target.value) || 0 } : x
                      )
                    )
                  }
                  inputMode="decimal"
                  placeholder="0.00"
                  className={`${field} w-32 shrink-0 text-right`}
                />
                <button
                  type="button"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  aria-label="Remove line"
                  className="shrink-0 rounded-lg px-2 py-2 text-muted transition hover:text-ink"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setRows([...rows, { id: `m${Date.now()}`, description: "", amount: 0 }])
              }
              className="btn-press rounded-lg border border-line px-3.5 py-2 text-[13px] font-medium transition hover:border-black/30"
            >
              Add a line
            </button>
          </section>

          {/* ---------------- the invoice preview ---------------- */}
          <section className="card card-flat space-y-4 p-5 sm:p-7">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-[11px] text-muted">Invoice number</label>
                <input
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  className={`${field} w-44`}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted">Date</label>
                <input
                  type="date"
                  value={issuedOn}
                  onChange={(e) => setIssuedOn(e.target.value)}
                  className={`${field} w-44`}
                />
              </div>
              <div className="ml-auto text-right">
                <div className="text-[11px] text-muted">Total</div>
                <div className="text-[24px] font-semibold leading-tight">{money(total)}</div>
              </div>
            </div>

            {allRows.length ? (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                    <th className="py-2 font-semibold">Description</th>
                    <th className="py-2 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {allRows.map((r) => (
                    <tr key={r.id} className="border-b border-line/60">
                      <td className="py-2 pr-4">{r.description || "—"}</td>
                      <td className="py-2 text-right tnum">{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[13px] text-muted">
                Nothing on the invoice yet — tick a fee above or add your own line.
              </p>
            )}

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything accounts should know…"
              className="h-20 w-full resize-none rounded-xl border border-line bg-transparent p-3 text-[13px] outline-none transition focus:border-black/30"
            />

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!allRows.length || !profile.businessName}
                onClick={() => download("pdf")}
                className="btn-press accent-bg rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                Download PDF
              </button>
              <button
                type="button"
                disabled={!allRows.length || !profile.businessName}
                onClick={() => download("doc")}
                className="btn-press rounded-lg border border-line px-4 py-2 text-[13px] font-semibold transition hover:border-black/30 disabled:opacity-50"
              >
                Download Word
              </button>
              {!profile.businessName ? (
                <span className="text-[12px] text-muted">
                  Add your business name first — it goes on the invoice.
                </span>
              ) : null}
            </div>
          </section>
        </div>

        {/* ---------------- right: who you are ---------------- */}
        <section className="card card-flat space-y-3 p-5">
          <div className="flex items-center gap-2">
            <DoodleIcon name="user" size={16} className="text-accent" />
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
              Your business
            </h2>
          </div>
          <p className="text-[12px] text-muted">
            This goes on the invoice — your details, not the agency&apos;s. Asked
            once, reused every time.
          </p>
          <input
            value={profile.businessName}
            onChange={(e) => set({ businessName: e.target.value })}
            placeholder="Business name"
            className={field}
          />
          <textarea
            value={profile.address}
            onChange={(e) => set({ address: e.target.value })}
            placeholder="Address"
            className="h-20 w-full resize-none rounded-lg border border-line bg-transparent p-3 text-[13px] outline-none transition focus:border-black/30"
          />
          <input
            value={profile.email}
            onChange={(e) => set({ email: e.target.value })}
            placeholder="Billing email"
            className={field}
          />
          <input
            value={profile.phone}
            onChange={(e) => set({ phone: e.target.value })}
            placeholder="Phone"
            className={field}
          />
          <input
            value={profile.vatNumber}
            onChange={(e) => set({ vatNumber: e.target.value })}
            placeholder="VAT number (leave blank if not registered)"
            className={field}
          />
          <textarea
            value={profile.bankDetails}
            onChange={(e) => set({ bankDetails: e.target.value })}
            placeholder="Bank details for payment"
            className="h-16 w-full resize-none rounded-lg border border-line bg-transparent p-3 text-[13px] outline-none transition focus:border-black/30"
          />
          <div>
            <label className="mb-1 block text-[11px] text-muted">
              Your share of the management fee
            </label>
            <div className="flex items-center gap-2">
              <input
                value={profile.feePercent}
                onChange={(e) => set({ feePercent: Number(e.target.value) || 0 })}
                inputMode="decimal"
                className={`${field} w-24`}
              />
              <span className="text-[13px] text-muted">%</span>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              70% to start with — change it if yours differs.
            </p>
          </div>
          <SaveButton onSave={saveProfile} label="Save details" variant="quiet" />
        </section>
      </div>
    </div>
  );
}

/** The printable document. Deliberately plain HTML — it has to survive being
 *  opened by Word and by a print dialog, neither of which run our stylesheet. */
function invoiceHtml({
  profile,
  invoiceNo,
  issuedOn,
  rows,
  total,
  notes,
  month,
}: {
  profile: Profile;
  invoiceNo: string;
  issuedOn: string;
  rows: Row[];
  total: number;
  notes: string;
  month: string;
}): string {
  const esc = (s: string) =>
    s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
  const line = (r: Row) =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(r.description || "—")}</td>` +
    `<td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${money(r.amount)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(invoiceNo)}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:720px;margin:40px auto;font-size:13px;line-height:1.5">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px">
    <div>
      <h1 style="margin:0 0 4px;font-size:22px">${esc(profile.businessName)}</h1>
      <div style="white-space:pre-line;color:#555">${esc(profile.address)}</div>
      <div style="color:#555">${esc(profile.email)}${profile.phone ? " · " + esc(profile.phone) : ""}</div>
      ${profile.vatNumber ? `<div style="color:#555">VAT ${esc(profile.vatNumber)}</div>` : ""}
    </div>
    <div style="text-align:right">
      <div style="font-size:20px;font-weight:600">INVOICE</div>
      <div style="color:#555">${esc(invoiceNo)}</div>
      <div style="color:#555">${esc(issuedOn)}</div>
    </div>
  </div>
  <p style="margin:28px 0 6px;color:#555">Management fees — ${esc(monthLabel(month))}</p>
  <table style="width:100%;border-collapse:collapse">
    <thead><tr>
      <th style="text-align:left;padding:6px 0;border-bottom:2px solid #111;font-size:11px;text-transform:uppercase">Description</th>
      <th style="text-align:right;padding:6px 0;border-bottom:2px solid #111;font-size:11px;text-transform:uppercase">Amount</th>
    </tr></thead>
    <tbody>${rows.map(line).join("")}</tbody>
    <tfoot><tr>
      <td style="padding:12px 0;font-weight:600">Total</td>
      <td style="padding:12px 0;text-align:right;font-weight:600;font-size:16px">${money(total)}</td>
    </tr></tfoot>
  </table>
  ${notes ? `<p style="margin-top:24px;white-space:pre-line;color:#555">${esc(notes)}</p>` : ""}
  ${profile.bankDetails ? `<div style="margin-top:28px;padding-top:16px;border-top:1px solid #eee;white-space:pre-line;color:#555">${esc(profile.bankDetails)}</div>` : ""}
</body></html>`;
}
