// British formatting helpers — every figure in the UI goes through these.
// Pure functions, safe on server and client.

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const GBP_PENCE = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "£12,000" — or "£12,000.50" with pence=true. null/undefined → "—". */
export function formatGBP(
  value: number | null | undefined,
  pence = false
): string {
  if (value == null || Number.isNaN(value)) return "—";
  return pence ? GBP_PENCE.format(value) : GBP.format(value);
}

/** "90%" (dp decimal places, default 0). null/undefined → "—". */
export function formatPct(
  value: number | null | undefined,
  dp = 0
): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(dp)}%`;
}

/** "12,345" with en-GB thousands separators. null/undefined → "—". */
export function formatNum(
  value: number | null | undefined,
  dp = 0
): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-GB", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/** "11 Jul 2026" from an ISO date/datetime string or Date. Invalid → "—". */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "11 Jul" — short form used by SourceBadge. Invalid → "". */
export function formatDateShort(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** monthLabel("2026-07") → "July 2026". Malformed input returned as-is. */
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!m) return month ?? "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** Current month as "2026-07". */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The last `count` months ending at the current one, oldest first.
 *
 * Rolls itself on the 1st. This exists because the month list used to be typed
 * out by hand ("2026-01" … "2026-07"), which meant that on 1 August the
 * dashboard had no August to offer and quietly kept showing July — the figures
 * weren't stale, nobody could ask for the new month. Twelve months rather than
 * year-to-date so January doesn't leave you unable to look back at December.
 */
export function recentMonths(count = 12): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * The last month that has actually finished — "2026-07" during August.
 *
 * The reporting rule for anything that counts completed work: a figure for the
 * month you are standing in is always wrong, because the month is still
 * happening. Move-ins on the 3rd look catastrophic against a full July, and
 * nobody reading it pauses to correct for that.
 *
 * Rolls itself on the 1st, like recentMonths — so on 1 September this starts
 * answering August with no edit and no deploy.
 */
export function previousMonth(from: string = currentMonth()): string {
  const m = /^(\d{4})-(\d{2})$/.exec(from) ?? /^(\d{4})-(\d{2})$/.exec(currentMonth())!;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Months from January of the current year up to the last COMPLETE month.
 *
 * The income charts ran to a month typed out by hand, so they still ended at
 * June in August. This ends where the data actually ends and moves on its own.
 * Returns an empty list in January, when there is no complete month this year —
 * callers must handle that rather than assume at least one.
 */
export function monthsThisYearToDate(): string[] {
  const end = previousMonth();
  const [y, m] = end.split("-").map(Number);
  const now = new Date();
  if (y < now.getFullYear()) return []; // January: last complete month was December
  return Array.from({ length: m }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
}

/** True when `month` is the month we're living in — i.e. still accumulating. */
export function isLiveMonth(month: string): boolean {
  return month === currentMonth();
}

/**
 * How far through the live month we are, in plain words: "day 7 of 31".
 * Past months are closed and say so. This is the context that stops a small
 * number on the 7th reading as a bad month rather than an early one.
 */
export function monthProgressLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!m) return "";
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const now = new Date();
  const curYear = now.getFullYear();
  const curMon = now.getMonth() + 1;
  if (year < curYear || (year === curYear && mon < curMon)) return "Closed";
  if (year > curYear || (year === curYear && mon > curMon)) return "Not started";
  return `Live · day ${now.getDate()} of ${new Date(year, mon, 0).getDate()}`;
}

/**
 * Fraction of the given month ("2026-07") that has elapsed, 0..1.
 * Past months → 1, future months → 0, current month → daysElapsed/daysInMonth.
 * Used for month-end run-rate predictions (actual / fraction).
 */
export function daysElapsedFraction(month: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (!m) return 1;
  const year = Number(m[1]);
  const mon = Number(m[2]); // 1-based
  const now = new Date();
  const curYear = now.getFullYear();
  const curMon = now.getMonth() + 1;
  if (year < curYear || (year === curYear && mon < curMon)) return 1;
  if (year > curYear || (year === curYear && mon > curMon)) return 0;
  const daysInMonth = new Date(year, mon, 0).getDate();
  return Math.min(1, Math.max(0, now.getDate() / daysInMonth));
}

/**
 * A VAT-inclusive fee, net of VAT — exactly as the accounts spreadsheet does it.
 *
 * NOT `gross / 1.2`. The sheet rounds the VAT and subtracts it, which differs by
 * a penny whenever the third decimal lands on a 5. Checked across all 96
 * populated cells of the Agent Earnings Table: 95 follow this, and every case
 * where the two methods disagree follows this one — Tony Poon's April is
 * 1,033.53 gross, 861.27 on the sheet, and 861.28 by division.
 *
 * Lives HERE rather than in payprop-income because the admin tabs are client
 * components and payprop-income sits behind "server-only" — a display that
 * can't net a figure is how the Income tab showed July ~£61.3k against the
 * £51,068 on the accounts summary: same fees, theirs exc VAT, ours inc.
 */
export const exVat = (gross: number): number => {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return round2(gross - round2(gross / 6));
};

/**
 * Money, shortened for a tile: £280k, £1.24m.
 *
 * A headline tile has room for a shape, not a ledger entry — "£280,105"
 * overflows and reads as noise, and nobody makes a decision on the last three
 * digits of a year-to-date figure. The exact amount is never lost: callers put
 * `formatGBPExact` in the hover, so precision is one mouse-move away.
 *
 * Small figures are left alone. £4,903 is already short, and rounding it to
 * £4.9k would throw away detail that fits perfectly well.
 */
export function formatGBPCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const neg = n < 0;
  const v = Math.abs(n);
  let out: string;
  if (v >= 1_000_000) {
    // Two decimals below ten million, so £1.24m doesn't collapse to £1m.
    out = `£${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2)}m`;
  } else if (v >= 100_000) {
    out = `£${Math.round(v / 1000)}k`;
  } else if (v >= 10_000) {
    out = `£${(v / 1000).toFixed(1)}k`;
  } else {
    out = `£${Math.round(v).toLocaleString("en-GB")}`;
  }
  return neg ? `-${out}` : out;
}

/** The full amount, pounds AND pence — what the hover shows. */
export function formatGBPExact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
