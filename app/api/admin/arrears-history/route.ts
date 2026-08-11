import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import {
  arrearsSpells,
  captureToday,
  listSnapshotDates,
  parseArrearsImport,
  saveSnapshot,
  snapshotForMonth,
  type ArrearsSnapshot,
} from "@/lib/arrears-history";

/**
 * The arrears LOG — who was behind, and when.
 *
 * GET  ?month=YYYY-MM      → the snapshot answering for that month, plus how
 *                            long each currently-behind tenant has been behind
 * POST { capture: true }   → store today's live PayProp read, once a day
 * POST { asAt, text }      → parse a pasted PayProp export; `commit` to store
 *
 * ADMIN ONLY — every row names a tenant.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function admin(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const user = userId ? await findById(userId) : null;
  return user && isAdminEmail(user.email) ? user : null;
}

export async function GET(req: NextRequest) {
  if (!(await admin(req))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 403 });
  }
  const param = req.nextUrl.searchParams.get("month");
  const month = param && MONTH_RE.test(param) ? param : new Date().toISOString().slice(0, 7);

  const [snapshot, dates] = await Promise.all([
    snapshotForMonth(month).catch(() => null),
    listSnapshotDates().catch(() => [] as string[]),
  ]);
  const spells = snapshot ? await arrearsSpells(snapshot.asAt).catch(() => null) : null;

  return NextResponse.json({
    month,
    /** null = we hold nothing for this month. NOT "nobody was in arrears". */
    snapshot: snapshot
      ? {
          asAt: snapshot.asAt,
          source: snapshot.source,
          note: snapshot.note ?? null,
          totalOwed: snapshot.totalOwed,
          checked: snapshot.checked,
          tenants: snapshot.people.length,
          largest: snapshot.people.reduce((m, p) => Math.max(m, p.owed), 0),
          average: snapshot.people.length
            ? snapshot.totalOwed / snapshot.people.length
            : 0,
          people: snapshot.people,
        }
      : null,
    /** Whether that snapshot is actually FROM the month asked for. */
    exact: snapshot ? snapshot.asAt.slice(0, 7) === month : false,
    spells: spells?.spells ?? [],
    thin: spells?.thin ?? true,
    snapshots: dates,
  });
}

export async function POST(req: NextRequest) {
  if (!(await admin(req))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    capture?: boolean;
    asAt?: string;
    text?: string;
    note?: string;
    commit?: boolean;
  };

  if (body.capture) {
    return NextResponse.json(await captureToday());
  }

  const { asAt, text } = body;
  if (!asAt || !DATE_RE.test(asAt)) {
    return NextResponse.json(
      { error: "asAt must be the date the balances were true, as YYYY-MM-DD." },
      { status: 400 }
    );
  }
  if (asAt > new Date().toISOString().slice(0, 10)) {
    return NextResponse.json({ error: "That date is in the future." }, { status: 400 });
  }
  if (!text || !text.trim()) {
    return NextResponse.json({ error: "Paste the export first." }, { status: 400 });
  }

  const parsed = parseArrearsImport(text);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // Parsed and shown back BEFORE anything is written. A mis-read column here
  // becomes the permanent record of who owed what — it is worth one look.
  if (!body.commit) {
    return NextResponse.json({
      preview: true,
      asAt,
      columns: parsed.columns,
      tenants: parsed.people.length,
      totalOwed: parsed.totalOwed,
      skipped: parsed.skipped,
      owedIsNegative: parsed.owedIsNegative,
      credits: parsed.credits,
      people: parsed.people.slice(0, 25),
    });
  }

  const snap: ArrearsSnapshot = {
    asAt,
    source: "upload",
    people: parsed.people,
    totalOwed: parsed.totalOwed,
    // An upload carries no tenancy count unless the export had one, and
    // inventing a denominator would make "40 of 512" a fiction.
    checked: null,
    note: body.note?.slice(0, 300),
  };
  const stored = await saveSnapshot(snap);
  return NextResponse.json({
    stored,
    asAt,
    tenants: parsed.people.length,
    totalOwed: parsed.totalOwed,
    skipped: parsed.skipped,
    error: stored ? undefined : "Couldn't write to the database.",
  });
}
