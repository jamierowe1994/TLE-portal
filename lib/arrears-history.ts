import "server-only";
import { hasDb, q } from "@/lib/db";
import { getArrears } from "@/lib/payprop-income";

/**
 * A log of who was behind on rent, and when.
 *
 * WHY THIS EXISTS. PayProp answers one question — what does this tenant owe
 * right now — and keeps no history of the answer. So the Arrears tab showed
 * the same 40 tenants under September last year as under today, and nobody
 * could ask the question that actually matters: how long has this one been
 * behind, and is it getting worse?
 *
 * Rebuilding the past from invoices minus payments was tried and MEASURED
 * against PayProp's own balances on a closed month: it agreed on 2 of 9 real
 * cases, invented 1, and missed 7. Mid-month it produced 44 false positives out
 * of 50. Arrears is the one figure here whose failure has a cost outside the
 * building — someone gets chased who doesn't owe — so that was rejected rather
 * than shipped.
 *
 * The honest alternative is to stop losing the answer. Every live read is
 * captured, once a day, exactly as PayProp gave it. Months before today come
 * from PayProp's own exports, loaded by hand. Neither is inferred: every row
 * in here was a real balance on a real date.
 *
 * ADMIN-ONLY. These rows name tenants.
 */

export interface ArrearsPerson {
  tenant: string;
  property: string;
  owed: number;
  /** PayProp's agency, when known — E&W and Glasgow are separate accounts. */
  account?: string | null;
  lastPayment?: string | null;
}

export interface ArrearsSnapshot {
  /** The day these balances were true, YYYY-MM-DD. */
  asAt: string;
  source: "payprop-live" | "upload";
  people: ArrearsPerson[];
  totalOwed: number;
  /** Tenancies checked, when the source knew — lets "40 of 512" stay honest. */
  checked: number | null;
  /** Free text from whoever uploaded it: which report, which export. */
  note?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* -------------------------------- storage -------------------------------- */

export async function listSnapshotDates(): Promise<string[]> {
  if (!hasDb()) return [];
  // to_char, not the raw DATE: node-postgres turns a date column into a JS
  // Date at LOCAL midnight, so toISOString() slides it to the previous day
  // through a British summer. The log would be off by one for half the year.
  const rows = await q<{ as_at: string }>(
    "SELECT to_char(as_at, 'YYYY-MM-DD') AS as_at FROM arrears_snapshots ORDER BY as_at"
  ).catch(() => []);
  return rows.map((r) => r.as_at);
}

export async function getSnapshot(asAt: string): Promise<ArrearsSnapshot | null> {
  if (!hasDb() || !DATE_RE.test(asAt)) return null;
  const rows = await q<{ data: string }>(
    "SELECT data FROM arrears_snapshots WHERE as_at = $1",
    [asAt]
  ).catch(() => []);
  if (!rows[0]) return null;
  try {
    return JSON.parse(rows[0].data) as ArrearsSnapshot;
  } catch {
    return null;
  }
}

export async function saveSnapshot(snap: ArrearsSnapshot): Promise<boolean> {
  if (!hasDb() || !DATE_RE.test(snap.asAt)) return false;
  const res = await q(
    `INSERT INTO arrears_snapshots (as_at, source, data) VALUES ($1, $2, $3)
     ON CONFLICT (as_at) DO UPDATE SET source = $2, data = $3, captured_at = NOW()`,
    [snap.asAt, snap.source, JSON.stringify(snap)]
  )
    .then(() => true)
    .catch(() => false);
  return res;
}

/**
 * The snapshot that answers for `month` — the LAST one on or before the end of
 * that month.
 *
 * Deliberately not "any snapshot in the month": a balance taken on the 3rd is a
 * different thing from one taken on the 30th, and month-end is the one everyone
 * means. Returns null rather than reaching forward — a later snapshot is not
 * evidence about an earlier month.
 */
export async function snapshotForMonth(month: string): Promise<ArrearsSnapshot | null> {
  if (!hasDb() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const rows = await q<{ data: string }>(
    "SELECT data FROM arrears_snapshots WHERE as_at <= $1 ORDER BY as_at DESC LIMIT 1",
    [monthEnd]
  ).catch(() => []);
  if (!rows[0]) return null;
  try {
    return JSON.parse(rows[0].data) as ArrearsSnapshot;
  } catch {
    return null;
  }
}

/* ------------------------------- capturing ------------------------------- */

/**
 * Store today's live PayProp arrears, if today isn't already stored.
 *
 * Called from the Arrears tab once the live figures land, so the log starts
 * filling from the day this ships without anyone remembering to do it. Cheap:
 * the live read is already cached, and a second call the same day is a no-op.
 */
export async function captureToday(): Promise<{ stored: boolean; asAt: string; reason?: string }> {
  const asAt = new Date().toISOString().slice(0, 10);
  if (!hasDb()) return { stored: false, asAt, reason: "no database" };
  if (await getSnapshot(asAt)) return { stored: false, asAt, reason: "already captured today" };

  const live = await getArrears().catch(() => null);
  // cachedAsync returns null on a cold key and computes behind. Storing that as
  // "nobody was in arrears today" would put a false clean day in the record
  // permanently, so nothing is written until there is a real answer.
  if (!live) return { stored: false, asAt, reason: "PayProp hasn't answered yet" };

  const ok = await saveSnapshot({
    asAt,
    source: "payprop-live",
    people: live.tenants.map((t) => ({
      tenant: t.tenant,
      property: t.property,
      owed: Math.round(t.owed * 100) / 100,
      lastPayment: null,
    })),
    totalOwed: Math.round(live.totalOwed * 100) / 100,
    checked: live.checked,
  });
  return { stored: ok, asAt };
}

/* -------------------------------- history -------------------------------- */

export interface ArrearsSpell {
  tenant: string;
  property: string;
  owed: number;
  /** First snapshot of the current unbroken run in which they owed money. */
  since: string;
  /** Snapshots in that run — 1 means "first time we've seen it". */
  seen: number;
  /** Owed at the start of the run, so the direction is visible. */
  owedThen: number;
}

function key(p: { tenant: string; property: string }): string {
  return `${p.tenant.trim().toLowerCase()}|${p.property.trim().toLowerCase()}`;
}

/**
 * How long each currently-behind tenant has been behind, across the snapshots
 * we hold up to `asAt`.
 *
 * The run is UNBROKEN by construction: a tenant who cleared their balance and
 * fell behind again starts a new spell, because "behind since January" would
 * otherwise be said of someone who has paid in full twice since.
 *
 * With one snapshot this says "first seen" for everyone, and says so — it is
 * not a claim that everybody's debt started today.
 */
export async function arrearsSpells(asAt?: string): Promise<{
  spells: ArrearsSpell[];
  snapshots: string[];
  /** True when only one snapshot exists, so "since" carries no information. */
  thin: boolean;
} | null> {
  if (!hasDb()) return null;
  const cutoff = asAt && DATE_RE.test(asAt) ? asAt : new Date().toISOString().slice(0, 10);
  const rows = await q<{ as_at: string; data: string }>(
    "SELECT to_char(as_at, 'YYYY-MM-DD') AS as_at, data FROM arrears_snapshots WHERE as_at <= $1 ORDER BY as_at",
    [cutoff]
  ).catch(() => []);
  if (rows.length === 0) return null;

  const dates: string[] = [];
  const parsed: ArrearsSnapshot[] = [];
  for (const r of rows) {
    try {
      const s = JSON.parse(r.data) as ArrearsSnapshot;
      parsed.push(s);
      dates.push(r.as_at);
    } catch {
      /* skip a corrupt row rather than shortening the history silently below */
    }
  }
  if (parsed.length === 0) return null;

  return {
    spells: computeSpells(parsed, dates),
    snapshots: dates,
    thin: dates.length < 2,
  };
}

/**
 * The run-walking itself, kept pure and exported so it can be exercised
 * without a database — this is the part that makes a claim about a named
 * person ("behind since January"), so it is the part worth testing.
 *
 * `snaps` and `dates` are parallel, oldest first.
 */
export function computeSpells(snaps: ArrearsSnapshot[], dates: string[]): ArrearsSpell[] {
  const run = new Map<string, { since: string; seen: number; owedThen: number }>();
  for (let i = 0; i < snaps.length; i++) {
    const present = new Set<string>();
    for (const p of snaps[i].people) {
      const k = key(p);
      present.add(k);
      const existing = run.get(k);
      if (existing) existing.seen++;
      else run.set(k, { since: dates[i], seen: 1, owedThen: p.owed });
    }
    // Anyone absent from this snapshot has cleared — their run ends here, so
    // falling behind again later starts from that later date.
    for (const k of [...run.keys()]) if (!present.has(k)) run.delete(k);
  }

  const latest = snaps[snaps.length - 1];
  return latest.people
    .map((p) => {
      const r = run.get(key(p));
      return {
        tenant: p.tenant,
        property: p.property,
        owed: p.owed,
        since: r?.since ?? dates[dates.length - 1],
        seen: r?.seen ?? 1,
        owedThen: r?.owedThen ?? p.owed,
      };
    })
    .sort((a, b) => a.since.localeCompare(b.since) || b.owed - a.owed);
}

/* -------------------------------- ingest --------------------------------- */

export interface ParsedImport {
  people: ArrearsPerson[];
  totalOwed: number;
  /** Lines the parser could not read — shown back, never silently dropped. */
  skipped: string[];
  /** Which column each field was taken from, so a mis-map is visible. */
  columns: Record<string, string>;
  /** Which way up the file was read. Shown, so a wrong reading is obvious. */
  owedIsNegative: boolean;
  /** Rows on the other side of zero — tenants in credit, deliberately dropped. */
  credits: number;
}

const HEADERS: Record<keyof ArrearsPerson | "checked", string[]> = {
  tenant: ["tenant", "tenant name", "name", "tenant(s)", "customer"],
  property: ["property", "property name", "address", "unit"],
  owed: ["balance", "owed", "arrears", "amount", "debit", "total owed", "outstanding"],
  account: ["account", "agency", "region", "office"],
  lastPayment: ["last payment", "last payment date", "last paid"],
  checked: ["checked"],
};

function splitLine(line: string): string[] {
  // Tab-separated first (what a spreadsheet paste gives), else CSV with quotes.
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function toMoney(raw: string): number | null {
  const cleaned = raw.replace(/[£$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

/**
 * Read a pasted PayProp arrears export — tab-separated (a spreadsheet paste) or
 * CSV. Columns are found by header name rather than position, because the
 * export's column order is not something we control.
 *
 * THE SIGN CONVENTION IS DECIDED PER FILE, NOT PER ROW. PayProp signs balances
 * from the tenant's side, so money owed comes through negative; other exports
 * are the other way up. Taking the absolute value of each row would be the easy
 * way to handle both — and it would silently turn a tenant £50 IN CREDIT into
 * a tenant £50 behind, which is the one mistake this whole feature exists to
 * avoid. So the majority sign in the file decides which way round it is, and
 * everything on the other side of zero is dropped as a credit and counted.
 *
 * Every line the parser could not read is handed back rather than quietly
 * skipped: a silently short list reads exactly like a good month.
 */
export function parseArrearsImport(text: string): ParsedImport | { error: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { error: "Needs a header row and at least one tenant row." };

  const header = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/[_-]+/g, " ").trim());
  const find = (names: string[]) =>
    header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));

  const iTenant = find(HEADERS.tenant);
  const iProperty = find(HEADERS.property);
  const iOwed = find(HEADERS.owed);
  const iAccount = find(HEADERS.account);
  const iLastPayment = find(HEADERS.lastPayment);

  if (iTenant < 0 || iOwed < 0) {
    return {
      error:
        `Couldn't find a tenant column and a balance column. Found: ${header.join(", ") || "nothing"}. ` +
        `Tenant can be headed ${HEADERS.tenant.join(" / ")}; balance ${HEADERS.owed.join(" / ")}.`,
    };
  }

  // Read every row first, so the file's sign convention can be decided from the
  // whole of it rather than guessed row by row.
  interface Raw {
    tenant: string;
    property: string;
    account: string | null;
    lastPayment: string | null;
    balance: number;
  }
  const raw: Raw[] = [];
  const skipped: string[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line);
    const tenant = (cells[iTenant] ?? "").trim();
    const balance = toMoney((cells[iOwed] ?? "").trim());
    if (!tenant || balance == null) {
      skipped.push(line.slice(0, 200));
      continue;
    }
    raw.push({
      tenant,
      property: iProperty >= 0 ? (cells[iProperty] ?? "").trim() || "—" : "—",
      account: iAccount >= 0 ? (cells[iAccount] ?? "").trim() || null : null,
      lastPayment: iLastPayment >= 0 ? (cells[iLastPayment] ?? "").trim() || null : null,
      balance,
    });
  }

  const negatives = raw.filter((r) => r.balance < -0.005).length;
  const positives = raw.filter((r) => r.balance > 0.005).length;
  // Ties go to PayProp's own convention (negative = owed), since that is what
  // this is loaded from in practice.
  const owedIsNegative = negatives >= positives;

  const people: ArrearsPerson[] = [];
  let credits = 0;
  for (const r of raw) {
    const owed = owedIsNegative ? -r.balance : r.balance;
    if (owed < 0.005) {
      // Square, or genuinely in credit. Not arrears either way.
      if (owed < -0.005) credits++;
      continue;
    }
    people.push({
      tenant: r.tenant,
      property: r.property,
      owed: Math.round(owed * 100) / 100,
      account: r.account,
      lastPayment: r.lastPayment,
    });
  }

  return {
    people: people.sort((a, b) => b.owed - a.owed),
    totalOwed: Math.round(people.reduce((t, p) => t + p.owed, 0) * 100) / 100,
    skipped,
    owedIsNegative,
    credits,
    columns: {
      tenant: header[iTenant],
      property: iProperty >= 0 ? header[iProperty] : "(none — shown as —)",
      balance: header[iOwed],
      ...(iAccount >= 0 ? { account: header[iAccount] } : {}),
      ...(iLastPayment >= 0 ? { lastPayment: header[iLastPayment] } : {}),
    },
  };
}
