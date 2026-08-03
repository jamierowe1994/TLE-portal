"use client";

// Compliance — what's outstanding across the agent's properties, worst first.
//
// Same shape as My Properties on purpose: tile → click → detail. The tile says
// how much needs doing; the drawer says exactly what. Property compliance only —
// REX also tracks contact-level checks (AML, Right to Rent), which is a
// different job and deliberately not mixed in here.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DoodleIcon from "@/components/DoodleIcon";
import SplitDrawer, { DrawerPanel } from "@/components/SplitDrawer";
import PropertyNotes from "@/components/PropertyNotes";
import PropertyDocuments from "@/components/PropertyDocuments";
import { rexListingUrl } from "@/lib/rex-links";
import FilterBar from "@/components/FilterBar";
import StatStrip from "@/components/StatStrip";
import QuickTabs from "@/components/QuickTabs";
import Loader from "@/components/Loader";
import NoPhoto from "@/components/NoPhoto";
import PageArt from "@/components/PageArt";
import DocumentSheet, { type SheetDoc } from "@/components/DocumentSheet";
import type { ComplianceItem, ComplianceState, PropertyCompliance } from "@/lib/rex-stats";
import { zoomOriginFrom, type ZoomOrigin } from "@/lib/zoom-origin";

const enterAt = (ms: number) =>
  ({ "--enter-delay": `${ms}ms` }) as React.CSSProperties;

const needsWork = (s: ComplianceState) =>
  s === "expired" || s === "expiring" || s === "missing";

const STATE_STYLE: Record<ComplianceState, string> = {
  expired: "border-red-200 bg-red-50 text-red-700",
  expiring: "border-amber-200 bg-amber-50 text-amber-700",
  missing: "border-amber-200 bg-amber-50 text-amber-700",
  valid: "border-line bg-page text-muted",
  "not-required": "border-line bg-page text-muted",
};

const STATE_DOT: Record<ComplianceState, string> = {
  expired: "bg-red-500",
  expiring: "bg-amber-500",
  missing: "bg-amber-500",
  valid: "bg-emerald-500",
  "not-required": "bg-gray-300",
};

/** Dot colour for an item — a source conflict shows amber whatever the state,
 *  because "two systems disagree" is a needs-a-look, not a green light. */
function dotFor(i: ComplianceItem): string {
  // A conflict raises severity to amber but must never LOWER it — an expired
  // certificate with a conflicting listing date is still expired (review find).
  if (i.state === "expired") return STATE_DOT.expired;
  return i.conflictingFieldExpiry ? STATE_DOT.expiring : STATE_DOT[i.state];
}

function stateLabel(i: ComplianceItem): string {
  // A date REX gave us but nobody can read is its own problem, and it outranks
  // whatever state we fell back to — say what's actually wrong.
  if (i.dateUnparsed) {
    return `Expiry date on file can't be read${i.expiry ? ` — "${i.expiry}"` : ""}`;
  }
  // The two sources disagreeing outranks either date being shown alone —
  // this is the exact discrepancy blocking automated EPC reminders, so it is
  // surfaced as the problem it is rather than one date winning quietly.
  if (i.conflictingFieldExpiry) {
    return `Record says ${i.expiry ?? "?"}, the listing says ${i.conflictingFieldExpiry} — needs a look`;
  }
  switch (i.state) {
    case "expired":
      return `Expired ${i.expiry ?? ""}`.trim();
    case "expiring": {
      const days = i.expiry
        ? Math.round((new Date(i.expiry).getTime() - Date.now()) / 86_400_000)
        : null;
      return days != null ? `Expires in ${days} days` : "Expiring";
    }
    case "missing":
      // A required certificate that has never been recorded reads differently
      // from one that lapsed — "renew this" vs "this was never here".
      return i.required ? "Required — nothing on file" : "Nothing on file";
    case "not-required":
      return "Not required";
    default:
      return `${i.expiry ? `Valid to ${i.expiry}` : i.issued ? `Recorded ${i.issued}` : "Recorded"}${
        i.source === "listing-field" ? " (from the listing)" : ""
      }`;
  }
}

/**
 * The badge every view of a property leads with. "Couldn't check" comes first
 * on purpose: when REX's answer was cut short we know nothing about this
 * property, and the two reassuring branches below would both be a guess.
 */
function badge(p: PropertyCompliance): { text: string; style: string } {
  if (!p.checked) return { text: "COULDN'T CHECK", style: STATE_STYLE.missing };
  if (p.outstanding > 0) {
    return {
      text: `${p.outstanding} OUTSTANDING`,
      style: p.items.some((i) => i.state === "expired")
        ? STATE_STYLE.expired
        : STATE_STYLE.expiring,
    };
  }
  return {
    text: p.items.length ? "ALL CLEAR" : "NOTHING RECORDED",
    style: STATE_STYLE.valid,
  };
}

/* -------------------------------- photo -------------------------------- */

function Photo({ p }: { p: PropertyCompliance }) {
  if (!p.image) {
    return <NoPhoto />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={p.image} alt={p.name} loading="lazy" className="h-full w-full object-cover" />;
}

/* --------------------------------- tile --------------------------------- */

function ComplianceTile({
  p,
  delay,
  onOpen,
}: {
  p: PropertyCompliance;
  delay: number;
  onOpen: (origin: ZoomOrigin) => void;
}) {
  const { text, style } = badge(p);
  return (
    <button
      type="button"
      onClick={(e) => onOpen(zoomOriginFrom(e))}
      className="enter enter-up card btn-press flex min-h-[210px] text-left transition hover:border-black/20"
      style={enterAt(delay)}
    >
      <div className="flex min-w-0 flex-1 flex-col p-6">
        <span className={`w-fit rounded-full border px-2 py-0.5 text-[9px] font-semibold ${style}`}>
          {text}
        </span>

        <h3 className="mt-3.5 truncate text-[14px] font-semibold leading-snug">{p.name}</h3>
        <p className="mt-0.5 truncate text-[12px] text-muted">{p.locality}</p>

        {/* A dot per item — the shape of the problem, before you click in. */}
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-4">
          {p.items.length ? (
            p.items.map((i) => (
              <span
                key={i.type}
                title={`${i.label} — ${stateLabel(i)}`}
                className={`h-1.5 w-1.5 rounded-full ${dotFor(i)}`}
              />
            ))
          ) : p.checked ? (
            <span className="text-[11px] text-muted">No compliance records</span>
          ) : null}

          {/* The dots are still worth showing — they're just not the whole
              picture, and the tile has to say which. */}
          {!p.checked ? (
            <span className="w-full text-[11px] text-amber-700">
              REX didn&apos;t finish answering — there may be more
            </span>
          ) : null}
        </div>
      </div>

      <div className="w-[38%] shrink-0 p-3 pl-0">
        <div className="relative h-full w-full overflow-hidden rounded-xl bg-page">
          <Photo p={p} />
        </div>
      </div>
    </button>
  );
}

/* -------------------------------- drawer -------------------------------- */

/** 30 days before expiry, or today if that has already gone by. */
function remindOn(expiry: string | null): string | null {
  if (!expiry) return null;
  const t = new Date(expiry).getTime();
  if (!Number.isFinite(t)) return null;
  const thirtyBefore = new Date(t - 30 * 86_400_000);
  const today = new Date();
  today.setHours(9, 0, 0, 0);
  return (thirtyBefore > today ? thirtyBefore : today).toISOString();
}

/** Minimal .ics so the reminder can live in a real calendar too. */
function downloadIcs(title: string, when: string, note: string) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const start = new Date(when);
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TLE OS//Compliance//EN",
    "BEGIN:VEVENT",
    `UID:${Date.now()}@tle-os`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(new Date(start.getTime() + 30 * 60_000))}`,
    `SUMMARY:${title.replace(/[\n,;]/g, " ")}`,
    `DESCRIPTION:${note.replace(/[\n,;]/g, " ")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The certificate itself — or an honest note that there isn't one.
 *
 * A compliance record existing and the certificate being attached are two
 * different things, and until now the page only showed the first. Across the
 * book (censused 3 Aug 2026) electrical, terms of business and proof of
 * ownership are attached almost always, gas safety about two thirds of the
 * time, and EPCs essentially never — so "in date" could mean a date somebody
 * typed with nothing behind it.
 *
 * The link points at our own route, never at REX's URL: REX serves these from
 * one host that signs with an expiry (so the link would rot) and one that
 * doesn't sign at all (so the URL would be a permanent, login-free key to a
 * landlord's paperwork).
 */
function CertificateLink({
  item,
  onOpen,
}: {
  item: ComplianceItem;
  onOpen: (d: SheetDoc) => void;
}) {
  if (!item.entryId) return null;
  if (!item.hasDocument) {
    return (
      <p className="mt-1 text-[11px] text-muted">
        No certificate attached — the record exists, the document doesn&apos;t.
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={() =>
        onOpen({
          src: `/api/compliance/document?entry=${encodeURIComponent(item.entryId!)}`,
          title: item.label,
          subtitle: item.expiry ? `Expires ${item.expiry}` : null,
        })
      }
      className="mt-1 text-[11px] text-ink underline underline-offset-2 hover:opacity-70"
    >
      View certificate
    </button>
  );
}

function ReminderButton({
  property,
  item,
}: {
  property: PropertyCompliance;
  item: ComplianceItem;
}) {
  const when = remindOn(item.expiry);
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");

  // Nothing to remind about without a date — and inventing one would be
  // worse than the button not being there.
  if (!when) return null;

  async function set() {
    if (state !== "idle") return;
    setState("saving");
    const title = `${item.label} — ${property.name}`;
    try {
      const res = await fetch("/api/my/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: `${item.label} expires ${item.expiry} — ${property.name}`,
          dueAt: when,
          property: property.name,
          platform: "REX",
        }),
      });
      if (!res.ok) throw new Error();
      downloadIcs(title, when!, `${item.label} expires ${item.expiry}. ${property.name}, ${property.locality}.`);
      setState("done");
    } catch {
      setState("idle");
    }
  }

  return (
    <button
      type="button"
      onClick={set}
      disabled={state !== "idle"}
      title={`Remind me on ${new Date(when).toLocaleDateString("en-GB")}`}
      className="btn-press shrink-0 self-start rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-muted transition hover:border-black/25 hover:text-ink disabled:opacity-60"
    >
      {state === "done" ? "Reminder set" : state === "saving" ? "Setting…" : "Set reminder"}
    </button>
  );
}

/** Landlord and tenant on the property, read from REX when the drawer opens. */
function ContactsCard({ p }: { p: PropertyCompliance }) {
  const [contacts, setContacts] = useState<
    Array<{ id: string; name: string; role: string | null; email: string | null; phone: string | null }> | null
  >(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/my/property-contacts?listingId=${encodeURIComponent(p.listingId)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d: { contacts?: typeof contacts }) => {
        if (live) setContacts(d.contacts ?? []);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [p.listingId]);

  const pick = (re: RegExp) => contacts?.find((c) => re.test(c.role ?? ""));
  const landlord = pick(/landlord|owner|vendor/i);
  const tenant = pick(/tenant|purchaser/i);

  const line = (
    who: { name: string; email: string | null; phone: string | null } | undefined,
    label: string
  ) =>
    who ? (
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
          <p className="truncate text-[13px] font-medium text-ink">{who.name}</p>
        </div>
        {who.email ? (
          <a
            href={`mailto:${who.email}?subject=${encodeURIComponent(`${p.name} — compliance`)}`}
            className="btn-press shrink-0 rounded-full border border-line px-3 py-1 text-[11px] font-semibold transition hover:border-black/25"
          >
            Message {label.toLowerCase()}
          </a>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="card card-flat p-5 sm:p-6">
      <h3 className="flex items-center gap-2 text-[15px]" style={{ fontWeight: 500 }}>
        <DoodleIcon name="call" size={17} className="text-accent" />
        Contacts
      </h3>
      <div className="mt-4 space-y-3">
        {contacts === null && !failed ? (
          <p className="text-[12px] text-muted">Reading contacts from REX…</p>
        ) : landlord || tenant ? (
          <>
            {line(landlord, "Landlord")}
            {line(tenant, "Tenant")}
          </>
        ) : (
          // Never "this property has no landlord" — we only know we could not
          // find one on the REX record.
          <p className="text-[12px] text-muted">
            No landlord or tenant is related to this listing in REX
            {failed ? " (and the lookup failed)" : ""} — open it in REX to add
            them.
          </p>
        )}
        <a
          href={rexListingUrl(p.listingId, "rental")}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[11px] font-semibold text-muted underline decoration-dotted underline-offset-2 transition hover:text-ink"
        >
          Open contacts in REX ↗
        </a>
      </div>
    </div>
  );
}

function Drawer({ p, onClose, origin }: { p: PropertyCompliance; onClose: () => void; origin?: ZoomOrigin }) {
  // The certificate currently open on top of the drawer, if any.
  const [sheet, setSheet] = useState<SheetDoc | null>(null);

  // Nothing expands any more: every panel is open at once, so Escape has one
  // job again — except while a document is open over the top, where Escape
  // belongs to the sheet. Closing both at once would dump the agent back to
  // the grid when they only wanted to shut the PDF.
  useEffect(() => {
    if (sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sheet]);

  // Only what needs a human gets a full row; everything already in date is
  // real information but not news, so it waits behind its own panel.
  const outstanding = p.items.filter((i) => needsWork(i.state));
  const settled = p.items.filter((i) => !needsWork(i.state));

  // The soonest thing to fall due, whatever it is.
  const nextDue = [...p.items]
    .filter((i) => i.expiry)
    .sort((a, b) => (a.expiry ?? "").localeCompare(b.expiry ?? ""))[0];

  // When REX's answer was cut short, every number on this screen is a count of
  // what we managed to read, not a total — so nothing may be labelled as one,
  // and no empty list may be worded as "there's nothing there".
  const partial = !p.checked;

  return (
    <SplitDrawer onClose={onClose} hideClose origin={origin}>
      <DrawerPanel
        className="relative shrink-0 grow-0 p-5 sm:p-7"
        style={{ width: "min(74rem, calc(100vw - 2rem))" }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="btn-press absolute right-5 top-5 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-page text-muted transition hover:text-ink"
        >
          <DoodleIcon name="cross" size={16} />
        </button>

        {/* ---- header: the property, then where its paperwork stands ---- */}
        <div className="flex flex-wrap items-center gap-5 pr-12">
          <div className="h-[76px] w-[104px] shrink-0 overflow-hidden rounded-xl bg-page">
            <Photo p={p} />
          </div>

          <div className="min-w-0">
            {/* Straight through to the property itself. */}
            <Link
              href={`/dashboard/listings?open=${encodeURIComponent(p.listingId)}`}
              className="text-[24px] leading-tight tracking-tight decoration-2 underline-offset-4 hover:underline"
              style={{ fontWeight: 500 }}
            >
              {p.name}
            </Link>
            <p className="mt-1 text-[13px] text-muted">{p.locality}</p>
            <span
              className={`mt-2 inline-block rounded-full border px-2.5 py-0.5 text-[9px] font-semibold ${
                badge(p).style
              }`}
            >
              {badge(p).text}
            </span>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-x-8 gap-y-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <DoodleIcon name="shield" size={22} className="mt-[3px] shrink-0 text-ink" />
              <div>
                <div className="text-[14px] font-semibold text-ink">{p.outstanding}</div>
                <div className="text-[11.5px] text-muted">
                  {partial ? "Need attention so far" : "Need attention"}
                </div>
              </div>
            </div>
            <div className="flex min-w-0 items-start gap-2.5">
              <DoodleIcon name="checklist" size={22} className="mt-[3px] shrink-0 text-ink" />
              <div>
                <div className="text-[14px] font-semibold text-ink">{p.items.length}</div>
                <div className="text-[11.5px] text-muted">
                  {partial ? "Items read so far" : "Items on file"}
                </div>
              </div>
            </div>
            <div className="flex min-w-0 items-start gap-2.5">
              <DoodleIcon name="calendar" size={22} className="mt-[3px] shrink-0 text-ink" />
              <div>
                <div className="text-[14px] font-semibold text-ink">
                  {/* An em dash here would read as "nothing due" — on a short
                      read we simply never got that far. */}
                  {nextDue?.expiry ?? (partial ? "Unknown" : "—")}
                </div>
                <div className="text-[11.5px] text-muted">
                  {partial ? "Soonest we could see" : "Next renewal"}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid items-stretch gap-5 lg:grid-cols-[1fr_1.08fr]">
          {/* ================= left: what needs doing ================= */}
          <div className="card p-5 sm:p-6">
            <h3 className="flex items-center gap-2 text-[15px]" style={{ fontWeight: 500 }}>
              <DoodleIcon name="shield" size={17} className="text-accent" />
              What needs doing
            </h3>

            {/* Said before the list, not after it: whatever follows is a partial
                answer, and the reader has to know that before they read it. */}
            {!p.checked ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-800">
                REX cut us off part-way through this property, so anything below is
                what we managed to read — not necessarily everything on file. Open
                it in REX to be sure.
              </div>
            ) : null}

            {/* `unmapped` is a set of distinct type ids, not of entries — three
                fire_alarm entries are one type, so "3 entries" would be a
                number nobody counted. Says types, like the banner up top. */}
            {p.unmapped.length ? (
              <div className="mt-4 rounded-xl border border-line bg-page p-4 text-[12px] text-muted">
                REX also holds{" "}
                {p.unmapped.length === 1
                  ? "a certificate type"
                  : `${p.unmapped.length} certificate types`}{" "}
                this page doesn&apos;t recognise ({p.unmapped.join(", ")}), so
                {p.unmapped.length === 1 ? " it isn't" : " they aren't"} counted here.
              </div>
            ) : null}

            {outstanding.length ? (
              <div className="mt-4 space-y-2.5">
                {outstanding.map((i) => (
                  <div
                    key={i.type}
                    className={`flex items-start gap-3 rounded-xl border p-4 ${STATE_STYLE[i.state]}`}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotFor(i)}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink">{i.label}</p>
                      <p className="mt-0.5 text-[12px] text-muted">{stateLabel(i)}</p>
                      {/* The issue date has been in REX all along and never
                          reached this page — it's how you tell a lapsed
                          certificate from one that was never renewed. */}
                      {i.issued ? (
                        <p className="mt-0.5 text-[11px] text-muted">Issued {i.issued}</p>
                      ) : null}
                      {i.notes ? (
                        <p className="mt-1 text-[11px] italic text-muted">{i.notes}</p>
                      ) : null}
                      {i.required ? (
                        <p className="mt-1 text-[11px] text-muted">
                          Expected for this property — no record in REX at all.
                        </p>
                      ) : (
                        <CertificateLink item={i} onOpen={setSheet} />
                      )}
                    </div>
                    {/* Set a reminder against the certificate itself. It lands
                        on the agent's own To-dos 30 days before expiry (today
                        if that date has already passed — a reminder for last
                        month helps nobody), and downloads an .ics so it can
                        live in their real calendar too. */}
                    <ReminderButton property={p} item={i} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[180px] items-center">
                <p
                  className="text-left font-light leading-tight tracking-tight text-ink"
                  style={{ fontSize: "clamp(26px, 2.4vw, 34px)" }}
                >
                  {!p.checked ? (
                    <>
                      Couldn&apos;t
                      <br />
                      check this one
                    </>
                  ) : p.items.length ? (
                    <>
                      Everything
                      <br />
                      in date
                    </>
                  ) : (
                    <>
                      Nothing
                      <br />
                      recorded yet
                    </>
                  )}
                </p>
              </div>
            )}

            {/* Everything already in date, in the SAME column — this card is
                the whole compliance picture now (EPC, terms of business, the
                lot), not just the problems. It used to hide behind a summary
                tile on the right. */}
            {settled.length ? (
              <div className="mt-6 border-t border-line pt-5">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  In date
                </h4>
                {/* One per row, full width. These were a two-up grid of narrow
                    chips, which left the actions fighting the label for space —
                    "Set reminder" wrapped awkwardly and a standard residential
                    property (three or four rows) looked cramped for no reason.
                    There is no shortage of width here; the constraint was
                    self-imposed. */}
                <div className="mt-3 space-y-2">
                  {settled.map((i) => (
                    <div
                      key={i.type}
                      title={i.notes ?? stateLabel(i)}
                      className="flex items-center gap-3 rounded-xl border border-line px-4 py-3"
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${dotFor(i)}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">
                          {i.label}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted">
                          {stateLabel(i)}
                          {i.issued ? ` · issued ${i.issued}` : ""}
                          {/* In date, but is the certificate actually there?
                              Worth saying even here — especially here. Folded
                              onto the meta line rather than a third row, which
                              made the tall ones taller than the rest. */}
                          {i.entryId && !i.hasDocument ? " · no certificate attached" : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        {i.entryId && i.hasDocument ? (
                          <button
                            type="button"
                            title="View certificate"
                            onClick={() =>
                              setSheet({
                                src: `/api/compliance/document?entry=${encodeURIComponent(i.entryId!)}`,
                                title: i.label,
                                subtitle: i.expiry ? `Expires ${i.expiry}` : null,
                              })
                            }
                            className="text-[11px] text-ink underline underline-offset-2 hover:opacity-70"
                          >
                            View
                          </button>
                        ) : null}
                        <ReminderButton property={p} item={i} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <p className="mt-5 text-[11px] text-muted">
              Live from REX. Certificates are updated in REX — this is the view,
              not the record.
            </p>
          </div>

          {/* ============ right: contacts, then the panels ============ */}
          <div className="flex flex-col gap-5">
            {/* Same slot Applications puts Tenant details in, so moving
                between the two tabs doesn't move the furniture. */}
            <ContactsCard p={p} />
            {/* ---- documents on file, ours and REX's ---- */}
            {/* Documents and Notes are the only two panels now, and neither
                hides behind a summary tile — Notes especially, which is where
                the agent actually writes. */}
            <div className="card card-flat flex flex-col p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-[15px]" style={{ fontWeight: 500 }}>
                    <DoodleIcon name="doc" size={17} className="text-accent" />
                    Documents
                  </h3>
                </div>
              <div className="mt-4 flex-1">
                <PropertyDocuments listingId={p.listingId} />
              </div>
            </div>

            {/* ---- notes: open by default, it is where the agent writes ---- */}
            <div className="card card-flat flex min-h-[16rem] flex-1 flex-col p-5 sm:p-6">
              <h3 className="flex items-center gap-2 text-[15px]" style={{ fontWeight: 500 }}>
                <DoodleIcon name="note" size={17} className="text-accent" />
                Notes
              </h3>
              <div className="mt-3 flex-1">
                <PropertyNotes listingId={p.listingId} name={p.name} />
              </div>
            </div>
          </div>
        </div>

        {/* ---- footer ---- */}
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-5">
          <a
            href={rexListingUrl(p.listingId, "rental")}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-press inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-[13px] font-semibold transition hover:border-black/30"
          >
            <DoodleIcon name="link" size={15} />
            Update in REX
          </a>
        </div>
      </DrawerPanel>

      {/* Sits above the drawer so the property stays put behind it. */}
      <DocumentSheet doc={sheet} onClose={() => setSheet(null)} />
    </SplitDrawer>
  );
}

/* --------------------------------- page --------------------------------- */

export default function CompliancePage() {
  const [properties, setProperties] = useState<PropertyCompliance[] | null>(null);
  const [linked, setLinked] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<PropertyCompliance | null>(null);
  // Where the drawer should grow from — the centre of the tile clicked.
  const [zoom, setZoom] = useState<ZoomOrigin>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("worst");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/my/compliance", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { linked?: boolean; properties?: PropertyCompliance[]; error?: string }) => {
        if (cancelled) return;
        setLinked(d.linked !== false);
        setProperties(d.properties ?? []);
        setError(d.error ?? null);
      })
      .catch(() => !cancelled && setError("Couldn't load your compliance."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const all = properties ?? [];
  const flagged = all.filter((p) => p.outstanding > 0);
  const totalOutstanding = all.reduce((t, p) => t + p.outstanding, 0);
  // Properties REX cut us off on, and certificate types it holds that this page
  // has no label for. Both are gaps in what's shown, so both get said out loud.
  const unchecked = all.filter((p) => !p.checked);
  const unmapped = [...new Set(all.flatMap((p) => p.unmapped))].sort();

  // The slices both the quick tabs and the Filter dropdown drive.
  const expiringSoon = (p: PropertyCompliance) =>
    p.items.some((i) => i.state === "expiring");
  const expired = (p: PropertyCompliance) => p.items.some((i) => i.state === "expired");
  const matches = (p: PropertyCompliance, key: string) => {
    if (key === "outstanding") return p.outstanding > 0;
    if (key === "expired") return expired(p);
    if (key === "expiring") return expiringSoon(p);
    // "All clear" and "Nothing recorded" both mean we got a complete answer —
    // an unchecked property belongs in neither.
    if (key === "clear") return p.checked && p.items.length > 0 && p.outstanding === 0;
    if (key === "none") return p.checked && p.items.length === 0;
    if (key === "unchecked") return !p.checked;
    return true;
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = all.filter((p) => {
      if (!matches(p, filter)) return false;
      if (q && !`${p.name} ${p.locality}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sort === "address") return [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "most") return [...list].sort((a, b) => b.outstanding - a.outstanding);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, filter, search, sort]);

  // The rate is computed over properties REX actually answered for. It used to
  // fall back to 100% when nothing had items, so a fetch that returned nothing
  // at all displayed a green "100% compliance rate" — null now, shown as "—".
  const checkedProps = all.filter((p) => p.checked);
  const clearCount = checkedProps.filter(
    (p) => p.items.length > 0 && p.outstanding === 0
  ).length;
  const withItems = checkedProps.filter((p) => p.items.length > 0).length;
  const complianceRate = withItems ? Math.round((clearCount / withItems) * 100) : null;
  const expiredCount = all.filter(expired).length;
  const expiringCount = all.filter(expiringSoon).length;
  const noneCount = all.filter((p) => p.checked && p.items.length === 0).length;

  return (
    // Same outline treatment as the rest of the portal.
    <div className="outline-cards soft-cards space-y-6">
      <div className="enter enter-up flex items-start justify-between gap-6" style={enterAt(60)}>
        <div className="min-w-0">
          <h1 className="tracking-tight" style={{ fontSize: "clamp(32px, 3.6vw, 46px)", lineHeight: 1.05, fontWeight: 500 }}>Compliance</h1>
          <p className="mt-1 max-w-xl text-[13px] text-muted">
            Anything outstanding across your properties, worst first. Tap one to see
            what needs doing.
          </p>
        </div>
        <PageArt name="compliance" className="-mt-4 w-[190px] xl:w-[230px]" />
      </div>

      {!linked ? (
        <div className="card accent-soft-bg border-red-100 p-4 text-[13px]">
          <span className="font-semibold accent-text">Your REX account isn&apos;t linked yet.</span>{" "}
          <span className="text-ink">Ask the admin to link your profile.</span>
        </div>
      ) : null}

      {error ? <div className="card p-6 text-center text-sm text-muted">{error}</div> : null}

      {/* A partial answer that looks complete is the one failure this page can't
          afford, so it leads with what's missing rather than burying it. */}
      {unchecked.length ? (
        <div className="card border-amber-200 bg-amber-50 p-4 text-[13px]">
          <span className="font-semibold text-amber-800">
            REX didn&apos;t finish answering for {unchecked.length}{" "}
            {unchecked.length === 1 ? "property" : "properties"}.
          </span>{" "}
          <span className="text-ink">
            They&apos;re marked &ldquo;couldn&apos;t check&rdquo; and left out of the
            compliance rate — treat them as unknown, not as clear.
          </span>
        </div>
      ) : null}

      {unmapped.length ? (
        <div className="card p-4 text-[13px]">
          <span className="font-semibold text-ink">
            REX holds {unmapped.length === 1 ? "a certificate type" : `${unmapped.length} certificate types`}{" "}
            this page doesn&apos;t recognise.
          </span>{" "}
          <span className="text-muted">
            {unmapped.join(", ")} — on the REX record, but not counted in anything below.
          </span>
        </div>
      ) : null}

      {loading ? (
        <Loader label="Checking your certificates…" />
      ) : linked && !error && all.length === 0 ? (
        <div className="card p-10 text-center text-[13px] text-muted">
          No properties to check.
        </div>
      ) : all.length > 0 ? (
        <>
          {/* Summary line (only when something needs doing) + filters on the right.
              The row is always there so the controls don't jump about. */}
          <div
            className="enter enter-up flex min-h-[40px] flex-wrap items-center justify-between gap-3"
            style={enterAt(140)}
          >
            <p className="text-[13px] text-muted">
              {totalOutstanding > 0 ? (
                <>
                  <span className="font-semibold text-ink">
                    {totalOutstanding} {totalOutstanding === 1 ? "item" : "items"} outstanding
                  </span>{" "}
                  across {flagged.length} of your {all.length} properties.
                </>
              ) : null}
            </p>
            <FilterBar
              options={[
                { key: "all", label: "All properties" },
                { key: "outstanding", label: "Outstanding" },
                { key: "expired", label: "Expired" },
                { key: "expiring", label: "Expiring soon" },
                { key: "clear", label: "All clear" },
                { key: "none", label: "Nothing recorded" },
                { key: "unchecked", label: "Couldn't check" },
              ]}
              value={filter}
              onChange={setFilter}
              search={search}
              onSearch={setSearch}
            />
          </div>

          {/* ---- the overview bar ---- */}
          <div className="enter enter-up" style={enterAt(170)}>
            <StatStrip
              items={[
                { icon: "home", value: String(all.length), label: "Total properties" },
                {
                  icon: "shield",
                  value: String(totalOutstanding),
                  label: "Items outstanding",
                  dot: totalOutstanding > 0 ? "amber" : undefined,
                },
                {
                  icon: "clock",
                  value: String(expiredCount),
                  // Was "Properties with an expiry", which reads as the opposite
                  // of what it counts — properties holding an EXPIRED item.
                  label: "With something expired",
                  dot: expiredCount > 0 ? "red" : undefined,
                },
                { icon: "checklist", value: String(clearCount), label: "All clear" },
                {
                  icon: "star",
                  value: complianceRate == null ? "—" : `${complianceRate}%`,
                  label: unchecked.length
                    ? `Compliance rate — ${unchecked.length} unchecked`
                    : "Compliance rate",
                  tone:
                    complianceRate == null ? "ink" : complianceRate >= 90 ? "green" : "red",
                },
              ]}
            />
          </div>

          {/* ---- quick cuts + sort ---- */}
          <div className="enter enter-up" style={enterAt(190)}>
            <QuickTabs
              tabs={[
                { key: "all", label: "All properties", count: all.length },
                { key: "outstanding", label: "Outstanding", count: flagged.length, dot: "amber" },
                { key: "expired", label: "Expired", count: expiredCount, dot: "red" },
                { key: "expiring", label: "Expiring soon", count: expiringCount, dot: "amber" },
                { key: "clear", label: "All clear", count: clearCount, dot: "green" },
                { key: "none", label: "Nothing recorded", count: noneCount },
                ...(unchecked.length
                  ? [
                      {
                        key: "unchecked",
                        label: "Couldn't check",
                        count: unchecked.length,
                        dot: "amber" as const,
                      },
                    ]
                  : []),
              ]}
              value={filter}
              onChange={setFilter}
              sort={sort}
              onSort={setSort}
              sortOptions={[
                { key: "worst", label: "Worst first" },
                { key: "most", label: "Most outstanding" },
                { key: "address", label: "Address A–Z" },
              ]}
            />
          </div>

          {shown.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-muted">
              Nothing matches — clear the filter or search.
            </p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 2xl:grid-cols-3">
              {shown.map((p, i) => (
                <ComplianceTile
                  key={p.listingId}
                  p={p}
                  delay={200 + i * 50}
                  onOpen={(o) => { setZoom(o); setOpen(p); }}
                />
              ))}
            </div>
          )}
        </>
      ) : null}

      {open ? <Drawer p={open} origin={zoom} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
