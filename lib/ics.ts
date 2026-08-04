// Calendar export for to-dos — one VEVENT per to-do, with alarms.
//
// Why this exists: the portal has no scheduler (no cron, no worker — Next.js
// on Railway only runs when someone hits a URL), so it cannot email anyone
// "in eleven months, chase the gas safety". A calendar can. We hand the agent
// an .ics with VALARMs in it and their own Outlook/Google does the reminding
// from then on, on infrastructure we don't have to run.
//
// The timezone rule, which is the whole reason this file is careful:
// `dueAt` is stored exactly as the datetime-local input produced it —
// "2026-03-14T09:00", naive, no zone. That string means 9am WHERE THE AGENT
// IS, and the server (UTC on Railway) must never "helpfully" convert it.
// iCalendar has a form for precisely this — a FLOATING date-time, DTSTART
// with no Z and no TZID, which every client interprets in its own local time.
// So a naive string maps to a floating DTSTART and no conversion ever happens.
// A dueAt that DOES carry a zone is a real instant and is emitted as UTC.

/** The three shapes `dueAt` is allowed to take once normalised. */
export type DueKind = "date" | "floating" | "utc";

export interface ParsedDue {
  kind: DueKind;
  /** The canonical stored string. */
  value: string;
  /** Rough instant, for deciding which alarms are still in the future. */
  approx: Date;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const ZONED = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Validate and canonicalise a due date. Returns null for "no date".
 * Throws on something that isn't a date at all — `dueAt` used to be a free
 * string ("display-parsed, not enforced"), which is fine for showing a chip
 * and useless for building an event.
 */
export function parseDue(raw: string | null | undefined): ParsedDue | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const d = DATE_ONLY.exec(s);
  if (d) {
    const approx = new Date(`${s}T12:00:00Z`);
    if (Number.isNaN(approx.getTime())) throw new Error("That date didn't look like a date.");
    return { kind: "date", value: s, approx };
  }

  const n = NAIVE.exec(s);
  if (n) {
    const [, y, mo, da, h, mi] = n;
    // Parsed as UTC only to sanity-check the numbers and to order alarms —
    // never written back, so no zone shift can leak into storage.
    const approx = new Date(`${y}-${mo}-${da}T${h}:${mi}:00Z`);
    if (Number.isNaN(approx.getTime())) throw new Error("That date didn't look like a date.");
    return { kind: "floating", value: `${y}-${mo}-${da}T${h}:${mi}`, approx };
  }

  const z = ZONED.exec(s);
  if (z) {
    const approx = new Date(s);
    if (Number.isNaN(approx.getTime())) throw new Error("That date didn't look like a date.");
    return { kind: "utc", value: approx.toISOString().replace(/\.\d{3}Z$/, "Z"), approx };
  }

  throw new Error("That date didn't look like a date.");
}

/** Canonical string to store, or null. Throws on unparseable input. */
export function normaliseDue(raw: string | null | undefined): string | null {
  return parseDue(raw)?.value ?? null;
}

/* --------------------------- iCalendar plumbing --------------------------- */

/** RFC 5545 TEXT escaping — backslash first or it eats the others. */
function esc(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold to 75 octets per RFC 5545. Octets, not characters — a line split
 * mid-UTF-8-sequence produces mojibake in the middle of a property name.
 */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Back off to a UTF-8 boundary: continuation bytes are 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // continuation lines carry a leading space
  }
  return out.join("\r\n ");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC stamp: 20260314T090000Z */
function utcStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** DTSTART/DTEND for each of the three due shapes. */
function startEnd(due: ParsedDue): { start: string; end: string } {
  if (due.kind === "date") {
    const compact = due.value.replace(/-/g, "");
    // All-day events are half-open: DTEND is the morning after.
    const next = new Date(`${due.value}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const endCompact = `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
    return {
      start: `DTSTART;VALUE=DATE:${compact}`,
      end: `DTEND;VALUE=DATE:${endCompact}`,
    };
  }

  if (due.kind === "floating") {
    // No Z, no TZID — the client reads it in its own local time, which is
    // exactly what a naive stored string means. One hour long.
    const [datePart, timePart] = due.value.split("T");
    const compact = `${datePart.replace(/-/g, "")}T${timePart.replace(":", "")}00`;
    const [h, mi] = timePart.split(":").map(Number);
    const endH = (h + 1) % 24;
    const rolls = h + 1 >= 24;
    let endDate = datePart.replace(/-/g, "");
    if (rolls) {
      const nd = new Date(`${datePart}T00:00:00Z`);
      nd.setUTCDate(nd.getUTCDate() + 1);
      endDate = `${nd.getUTCFullYear()}${pad(nd.getUTCMonth() + 1)}${pad(nd.getUTCDate())}`;
    }
    return {
      start: `DTSTART:${compact}`,
      end: `DTEND:${endDate}T${pad(endH)}${pad(mi)}00`,
    };
  }

  const startDate = new Date(due.value);
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  return { start: `DTSTART:${utcStamp(startDate)}`, end: `DTEND:${utcStamp(endDate)}` };
}

/**
 * Which reminders to bake in. The compliance cadence the business already
 * planned is 30/14/7 days before expiry; here we keep an offset only if it
 * would still fire in the future, and always keep at least one, so "chase
 * the EPC on Friday" doesn't export an event whose every alarm is in the past.
 */
const ALARM_DAYS = [30, 14, 7, 1];

function alarms(due: ParsedDue, now: Date): string[] {
  const future = ALARM_DAYS.filter(
    (days) => due.approx.getTime() - days * 86_400_000 > now.getTime()
  );
  const chosen = future.length ? future : [0];
  return chosen.flatMap((days) => [
    "BEGIN:VALARM",
    "ACTION:DISPLAY", // EMAIL alarms need an ATTENDEE and are patchily supported
    `TRIGGER:${days === 0 ? "PT0M" : `-P${days}D`}`,
    fold(`DESCRIPTION:${esc(days === 0 ? "Due now" : `Due in ${days} day${days === 1 ? "" : "s"}`)}`),
    "END:VALARM",
  ]);
}

export interface IcsTodo {
  id: string;
  note: string;
  dueAt: string | null;
  platform?: string | null;
  property?: string | null;
  tenant?: string | null;
}

/**
 * One to-do as a complete .ics document. Returns null when there's no date —
 * an event with no date isn't an event.
 *
 * The UID is derived from the to-do id and never changes, so re-adding an
 * updated to-do REPLACES the event in the agent's calendar instead of leaving
 * two of them. `stamp` is injectable so tests aren't clock-dependent.
 */
export function todoToIcs(todo: IcsTodo, stamp: Date = new Date()): string | null {
  const due = parseDue(todo.dueAt);
  if (!due) return null;

  const { start, end } = startEnd(due);
  const detail = [
    todo.property ? `Property: ${todo.property}` : null,
    todo.tenant ? `Tenant: ${todo.tenant}` : null,
    todo.platform ? `Platform: ${todo.platform}` : null,
  ].filter(Boolean);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Letting Experts//TLE Portal//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    fold(`UID:todo-${todo.id}@tle-portal`),
    `DTSTAMP:${utcStamp(stamp)}`,
    start,
    end,
    fold(`SUMMARY:${esc(todo.note)}`),
    ...(detail.length ? [fold(`DESCRIPTION:${esc(detail.join("\n"))}`)] : []),
    ...(todo.property ? [fold(`LOCATION:${esc(todo.property)}`)] : []),
    "STATUS:CONFIRMED",
    "TRANSP:TRANSPARENT",
    ...alarms(due, stamp),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // CRLF is mandatory, including a trailing one.
  return lines.join("\r\n") + "\r\n";
}

/** A safe, recognisable download name: "gas-safety-marine-parade.ics". */
export function icsFilename(note: string): string {
  const slug = note
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "reminder"}.ics`;
}
