import "server-only";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";
import { hasDb, q } from "@/lib/db";

// Assistant knowledge store — the head-office briefing library Susan curates
// from Admin → Assistant. Every entry is handed to the TLE Assistant as
// context, so agents' questions can be answered with TLE's own guidance
// (fee structures, processes, policies, how-tos).
//
// Dual backend like the other stores: Postgres (`assistant_knowledge`,
// schema in lib/db.ts) when DATABASE_URL is set, otherwise knowledge.json
// under DATA_DIR.

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  updatedAt: string; // ISO
}

// Guardrails so one giant paste can't blow the assistant's context.
export const KNOWLEDGE_MAX_ENTRY_CHARS = 20_000;
export const KNOWLEDGE_MAX_TITLE_CHARS = 200;

/* ------------------------------------------------------------------------ */
/* Postgres                                                                  */
/* ------------------------------------------------------------------------ */

interface KnowledgeRow extends Record<string, unknown> {
  id: string;
  title: string;
  content: string;
  updated_at: string | Date;
}

function rowToEntry(row: KnowledgeRow): KnowledgeEntry {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/* ------------------------------------------------------------------------ */
/* JSON fallback                                                             */
/* ------------------------------------------------------------------------ */

const FILE = path.join(DATA_DIR, "knowledge.json");

async function readAllFile(): Promise<KnowledgeEntry[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as KnowledgeEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeAllFile(rows: KnowledgeEntry[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(rows, null, 2), "utf8");
}

/* ------------------------------------------------------------------------ */
/* Store API                                                                 */
/* ------------------------------------------------------------------------ */

/** Every entry, most recently updated first. */
export async function listKnowledge(): Promise<KnowledgeEntry[]> {
  if (hasDb()) {
    const rows = await q<KnowledgeRow>(
      "SELECT id, title, content, updated_at FROM assistant_knowledge ORDER BY updated_at DESC"
    );
    return rows.map(rowToEntry);
  }
  const rows = await readAllFile();
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Create (no id) or update (with id). Trims + clamps to the guardrails. */
export async function upsertKnowledge(input: {
  id?: string | null;
  title: string;
  content: string;
}): Promise<KnowledgeEntry> {
  const entry: KnowledgeEntry = {
    id: input.id?.trim() || crypto.randomUUID(),
    title: input.title.trim().slice(0, KNOWLEDGE_MAX_TITLE_CHARS),
    content: input.content.trim().slice(0, KNOWLEDGE_MAX_ENTRY_CHARS),
    updatedAt: new Date().toISOString(),
  };
  if (!entry.title || !entry.content) {
    throw new Error("A knowledge entry needs both a title and some content.");
  }

  if (hasDb()) {
    await q(
      `INSERT INTO assistant_knowledge (id, title, content, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title, content = EXCLUDED.content, updated_at = NOW()`,
      [entry.id, entry.title, entry.content]
    );
    return entry;
  }

  const rows = await readAllFile();
  const idx = rows.findIndex((r) => r.id === entry.id);
  if (idx >= 0) rows[idx] = entry;
  else rows.push(entry);
  await writeAllFile(rows);
  return entry;
}

export async function deleteKnowledge(id: string): Promise<boolean> {
  if (hasDb()) {
    const rows = await q<{ id: string }>(
      "DELETE FROM assistant_knowledge WHERE id = $1 RETURNING id",
      [id]
    );
    return rows.length > 0;
  }
  const rows = await readAllFile();
  const next = rows.filter((r) => r.id !== id);
  if (next.length === rows.length) return false;
  await writeAllFile(next);
  return true;
}
