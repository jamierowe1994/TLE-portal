"use client";

import { useEffect, useRef, useState } from "react";
import DoodleIcon from "@/components/DoodleIcon";
import { BRAND } from "@/lib/brand";

// The partner's own compliance: the certificates a TLE agent has to hold and
// renew each year. Uploading one files a copy head office can see, and can
// drop a renewal reminder onto their To-dos a month before it lapses.

const TYPES = [
  { key: "pi-insurance", label: "Professional indemnity insurance" },
  { key: "client-money", label: "Client money protection" },
  { key: "redress", label: "Property redress scheme" },
  { key: "ico", label: "ICO registration" },
  { key: "aml", label: "Anti-money-laundering supervision" },
  { key: "propertymark", label: "Propertymark / qualification" },
  { key: "other", label: "Something else" },
];

interface Doc {
  id: string;
  type: string;
  label: string;
  name: string;
  size: number;
  expiry: string | null;
  createdAt: string;
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

/** Days until it lapses — negative once it has. */
const daysLeft = (iso: string | null) =>
  iso == null ? null : Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);

export default function AgentCompliancePanel() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [type, setType] = useState(TYPES[0].key);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState("");
  const [remind, setRemind] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = () =>
    fetch("/api/my/agent-compliance", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { docs?: Doc[] }) => setDocs(d.docs ?? []))
      .catch(() => setDocs([]));

  useEffect(() => {
    void load();
  }, []);

  async function upload(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("type", type);
      if (label.trim()) form.set("label", label.trim());
      if (expiry) form.set("expiry", expiry);
      form.set("remind", String(remind && Boolean(expiry)));

      const res = await fetch("/api/my/agent-compliance", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string; reminded?: boolean };
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? "Couldn't upload that." });
        return;
      }
      setMsg({
        ok: true,
        text: data.reminded
          ? "Uploaded, and a renewal reminder is on your To-dos."
          : "Uploaded — head office can see it.",
      });
      setLabel("");
      setExpiry("");
      await load();
    } catch {
      setMsg({ ok: false, text: "Couldn't upload that — try again." });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(id: string) {
    setDocs((prev) => prev?.filter((d) => d.id !== id) ?? null);
    await fetch(`/api/my/agent-compliance/${id}`, { method: "DELETE" }).catch(() => null);
  }

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
          <DoodleIcon name="shield" size={15} className="text-accent" />
          Your compliance
        </h2>
        <p className="mt-1.5 text-[12.5px] text-muted">
          The certificates you hold as a {BRAND.shortName} partner. Head office
          sees a copy of anything you upload, and most of these renew every year
          — add the expiry and we&rsquo;ll remind you a month before.
        </p>
      </div>

      {/* ---- what's on file ---- */}
      {docs === null ? (
        <p className="text-[12.5px] text-muted">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-black/20 px-4 py-5 text-center text-[12.5px] text-muted">
          Nothing on file yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {docs.map((d) => {
            const left = daysLeft(d.expiry);
            const state =
              left == null ? null : left < 0 ? "expired" : left <= 30 ? "soon" : "ok";
            return (
              <div
                key={d.id}
                className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5"
              >
                <DoodleIcon name="doc" size={15} className="shrink-0 text-muted" />
                <a
                  href={`/api/my/agent-compliance/${d.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1"
                >
                  <span className="block truncate text-[12.5px] text-ink">{d.label}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {d.name}
                    {d.expiry ? ` · expires ${fmt(d.expiry)}` : ""}
                  </span>
                </a>
                {state ? (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                      state === "expired"
                        ? "bg-red-100 text-red-700"
                        : state === "soon"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-emerald-100 text-emerald-700"
                    }`}
                  >
                    {state === "expired" ? "EXPIRED" : state === "soon" ? "DUE SOON" : "IN DATE"}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void remove(d.id)}
                  aria-label={`Remove ${d.label}`}
                  className="btn-press shrink-0 text-muted transition hover:text-ink"
                >
                  <DoodleIcon name="cross" size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- add one ---- */}
      <div className="space-y-3 border-t border-line pt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted">Document</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-xl border border-line bg-transparent px-3 py-2 text-[13px] outline-none transition focus:border-black/30"
            >
              {TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted">Expires</span>
            <input
              type="date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="w-full rounded-xl border border-line bg-transparent px-3 py-2 text-[13px] outline-none transition focus:border-black/30"
            />
          </label>
        </div>

        {type === "other" ? (
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What is it?"
            className="w-full border-0 border-b-[1.5px] border-ink/25 bg-transparent px-1 py-2 text-[13px] outline-none transition focus:border-ink/70"
          />
        ) : null}

        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          <input
            type="checkbox"
            checked={remind}
            onChange={(e) => setRemind(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#e31f36]"
          />
          Remind me a month before it expires
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="btn-press rounded-full px-4 py-2 text-[13px] font-semibold text-white transition disabled:opacity-50"
            style={{ background: BRAND.accent }}
          >
            {busy ? "Uploading…" : "Upload certificate"}
          </button>
          {msg ? (
            <span className={`text-[12.5px] ${msg.ok ? "text-emerald-600" : "accent-text"}`}>
              {msg.text}
            </span>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </div>
      </div>
    </section>
  );
}
