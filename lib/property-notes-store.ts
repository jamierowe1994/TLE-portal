import "server-only";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";
import { hasDb, q } from "@/lib/db";

// Property notes — the conversation log on a property drawer. Agents leave
// notes against a REX listing; the pre-tenancy team (Kirstie) can answer on
// the same thread. Dual backend like the other stores: Postgres
// (`property_notes`, schema in lib/db.ts) when DATABASE_URL is set, otherwise
// property-notes.json under DATA_DIR.

export interface PropertyNote {
  id: string;
  listingId: string;
  authorId: string;
  authorName: string;
  authorRole: "agent" | "team";
  text: string;
  createdAt: string;
}

const MAX_TEXT = 2000;

/* ------------------------------- Postgres -------------------------------- */

interface Row extends Record<string, unknown> {
  id: string;
  listing_id: string;
  author_id: string;
  author_name: string;
  author_role: string;
  text: string;
  created_at: string | Date;
}

function rowToNote(r: Row): PropertyNote {
  return {
    id: r.id,
    listingId: r.listing_id,
    authorId: r.author_id,
    authorName: r.author_name,
    authorRole: r.author_role === "team" ? "team" : "agent",
    text: r.text,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/* ----------------------------- JSON fallback ----------------------------- */

const FILE = path.join(DATA_DIR, "property-notes.json");

async function readAllFile(): Promise<PropertyNote[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PropertyNote[]) : [];
  } catch {
    return [];
  }
}

async function writeAllFile(notes: PropertyNote[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(notes, null, 2), "utf8");
}

/* --------------------------------- API ----------------------------------- */

export async function listPropertyNotes(listingId: string): Promise<PropertyNote[]> {
  if (hasDb()) {
    const rows = await q<Row>(
      "SELECT * FROM property_notes WHERE listing_id = $1 ORDER BY created_at ASC",
      [listingId]
    );
    return rows.map(rowToNote);
  }
  const all = await readAllFile();
  return all
    .filter((n) => n.listingId === listingId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addPropertyNote(input: {
  listingId: string;
  authorId: string;
  authorName: string;
  authorRole: "agent" | "team";
  text: string;
}): Promise<PropertyNote> {
  const note: PropertyNote = {
    id: crypto.randomBytes(8).toString("hex"),
    listingId: input.listingId,
    authorId: input.authorId,
    authorName: input.authorName,
    authorRole: input.authorRole,
    text: input.text.trim().slice(0, MAX_TEXT),
    createdAt: new Date().toISOString(),
  };
  if (hasDb()) {
    await q(
      `INSERT INTO property_notes (id, listing_id, author_id, author_name, author_role, text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [note.id, note.listingId, note.authorId, note.authorName, note.authorRole, note.text, note.createdAt]
    );
    return note;
  }
  const all = await readAllFile();
  all.push(note);
  await writeAllFile(all);
  return note;
}
