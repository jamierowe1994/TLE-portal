"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BRAND } from "@/lib/brand";

// The portal's calendar — lifted from the pre-tenancy board's picker so every
// date on the site looks the same: rounded card, Monday-first grid, selected
// day in brand red, quick picks, springy .cal-pop entrance. This one also
// carries an optional time row and a "chip" variant so a due-date pill on a
// tile can open the calendar directly.
//
// Value format: "" (unset), "YYYY-MM-DD", or "YYYY-MM-DDTHH:mm" — the same
// string a datetime-local input would give, so stores don't change.

const CAL_W = 264;
const CAL_H = 372;
const DP_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DP_DOW = ["M", "T", "W", "T", "F", "S", "S"];

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => toIso(new Date());

function parse(value: string): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const [date, time] = value.split("T");
  return { date: date ?? "", time: time ? time.slice(0, 5) : "" };
}

export default function DateTimePicker({
  value,
  onChange,
  variant = "field",
  withTime = true,
  overdue = false,
  placeholder = "Set a date",
}: {
  value: string;
  onChange: (v: string) => void;
  /** "field" = form input look; "chip" = little pill (for tiles). */
  variant?: "field" | "chip";
  withTime?: boolean;
  /** Chip only: paint it overdue-red. */
  overdue?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const { date, time } = parse(value);
  const selected = date ? new Date(`${date}T00:00:00`) : null;
  const [view, setView] = useState(() => (selected ? new Date(selected) : new Date()));
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (open && selected) setView(new Date(selected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fixed position from the trigger, clamped to the viewport.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const place = () => {
      const r = btnRef.current!.getBoundingClientRect();
      const left = Math.min(Math.max(8, r.left), window.innerWidth - CAL_W - 8);
      const below = r.bottom + 8;
      const top =
        below + CAL_H <= window.innerHeight - 8
          ? below
          : Math.max(8, r.top - CAL_H - 8);
      setPos({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const year = view.getFullYear();
  const month = view.getMonth();
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const label = selected
    ? selected.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) +
      (time ? ` · ${time}` : "")
    : placeholder;

  const commit = (nextDate: string, nextTime: string) => {
    if (!nextDate) onChange("");
    else onChange(nextTime ? `${nextDate}T${nextTime}` : nextDate);
  };
  const pick = (d: Date) => {
    commit(toIso(d), time);
    if (!withTime) setOpen(false);
  };
  const quick = (addDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + addDays);
    commit(toIso(d), time);
    setOpen(false);
  };

  const trigger =
    variant === "chip" ? (
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="Change the date"
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition hover:opacity-80 ${
          overdue
            ? "bg-red-50 font-semibold text-red-600"
            : value
              ? "bg-page text-muted"
              : "border border-dashed border-line text-muted/70"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x={3} y={4.5} width={18} height={16} rx={2.5} />
          <path d="M3 9h18M8 3v3M16 3v3" />
        </svg>
        {overdue ? "Overdue · " : ""}
        {label}
      </button>
    ) : (
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-lg border bg-white px-2.5 py-2 text-left text-[13px] outline-none transition ${
          open ? "border-black/25" : "border-line hover:border-black/20"
        } ${value ? "text-ink" : "text-muted/70"}`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x={3} y={4.5} width={18} height={16} rx={2.5} />
          <path d="M3 9h18M8 3v3M16 3v3" />
        </svg>
        {label}
      </button>
    );

  return (
    <>
      {trigger}
      {open && typeof document !== "undefined"
        ? createPortal(
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
              <div
                className="cal-pop fixed z-[61] w-[264px] rounded-2xl border border-line bg-card p-3 shadow-xl"
                style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setView(new Date(year, month - 1, 1))}
                    className="btn-press flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:bg-page hover:text-ink"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                  </button>
                  <span className="text-[13px] font-semibold">{DP_MONTHS[month]} {year}</span>
                  <button
                    type="button"
                    onClick={() => setView(new Date(year, month + 1, 1))}
                    className="btn-press flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:bg-page hover:text-ink"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {DP_DOW.map((d, i) => (
                    <span key={i} className="py-1 text-center text-[10px] font-semibold uppercase text-muted">{d}</span>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {cells.map((d, i) => {
                    if (!d) return <span key={i} />;
                    const iso = toIso(d);
                    const isSel = iso === date;
                    const isToday = iso === todayIso();
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => pick(d)}
                        style={{ ["--cal-delay" as string]: `${i * 6}ms` }}
                        className={`cal-day flex h-8 items-center justify-center rounded-full text-[12.5px] transition ${
                          isSel
                            ? "font-semibold text-white"
                            : isToday
                              ? "font-semibold accent-text"
                              : "text-ink hover:bg-page"
                        }`}
                      >
                        <span
                          className={isSel ? "flex h-8 w-8 items-center justify-center rounded-full" : ""}
                          style={isSel ? { background: BRAND.accent } : undefined}
                        >
                          {d.getDate()}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {withTime ? (
                  <div className="mt-2 flex items-center gap-1.5 border-t border-line pt-2">
                    <span className="mr-0.5 text-[11px] font-medium text-muted">Time</span>
                    {/* On-theme hour/minute — no blue native time spinner. */}
                    <select
                      value={time ? time.split(":")[0] : ""}
                      onChange={(e) => {
                        const hh = e.target.value;
                        const mm = time ? time.split(":")[1] : "00";
                        commit(date || todayIso(), hh === "" ? "" : `${hh}:${mm}`);
                      }}
                      className="flex-1 cursor-pointer appearance-none rounded-lg border border-line bg-white px-2 py-1.5 text-center text-[12.5px] tnum text-ink outline-none transition hover:border-black/20 focus:border-black/25"
                    >
                      <option value="">--</option>
                      {Array.from({ length: 24 }, (_, h) => {
                        const v = String(h).padStart(2, "0");
                        return <option key={v} value={v}>{v}</option>;
                      })}
                    </select>
                    <span className="text-[12px] text-muted">:</span>
                    <select
                      value={time ? time.split(":")[1] : ""}
                      disabled={!time}
                      onChange={(e) => {
                        const hh = time ? time.split(":")[0] : "09";
                        commit(date || todayIso(), `${hh}:${e.target.value}`);
                      }}
                      className="flex-1 cursor-pointer appearance-none rounded-lg border border-line bg-white px-2 py-1.5 text-center text-[12.5px] tnum text-ink outline-none transition hover:border-black/20 focus:border-black/25 disabled:opacity-40"
                    >
                      {["00","05","10","15","20","25","30","35","40","45","50","55"].map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    {time ? (
                      <button
                        type="button"
                        onClick={() => commit(date, "")}
                        className="ml-0.5 text-[11px] font-medium text-muted transition hover:text-ink"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-2 flex gap-1.5 border-t border-line pt-2">
                  {[
                    { label: "Today", days: 0 },
                    { label: "Tomorrow", days: 1 },
                    { label: "+1 week", days: 7 },
                  ].map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => quick(q.days)}
                      className="btn-press flex-1 rounded-lg bg-page px-2 py-1.5 text-[11px] font-medium text-muted transition hover:text-ink"
                    >
                      {q.label}
                    </button>
                  ))}
                  {value ? (
                    <button
                      type="button"
                      onClick={() => {
                        onChange("");
                        setOpen(false);
                      }}
                      className="btn-press flex-1 rounded-lg bg-page px-2 py-1.5 text-[11px] font-medium text-muted transition hover:text-red-600"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            </>,
            document.body
          )
        : null}
    </>
  );
}
