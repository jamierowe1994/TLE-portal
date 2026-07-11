import "server-only";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";
import { hasDb, q } from "@/lib/db";
import { isAdminEmail } from "@/lib/brand";
import type { AdminNote, UserProfile } from "@/lib/types";

// User store — dual backend like TEG: Postgres when DATABASE_URL is set,
// otherwise a pretty-printed JSON file under DATA_DIR.

export interface StoredUser extends UserProfile {
  passwordHash: string;
  adminNotes?: AdminNote[]; // internal — stripped before reaching the agent
}

/* ------------------------------------------------------------------------ */
/* Serialization boundaries                                                  */
/* ------------------------------------------------------------------------ */

/** Agent-facing: strip the secret AND internal admin notes. */
export function toPublic(user: StoredUser): UserProfile {
  const { passwordHash: _pw, adminNotes: _notes, ...pub } = user;
  return { ...pub, isAdmin: isAdminEmail(user.email) };
}

/** Admin-facing: strip only the secret (keeps adminNotes, location, links). */
export function toAdmin(user: StoredUser): UserProfile & { adminNotes?: AdminNote[] } {
  const { passwordHash: _pw, ...adm } = user;
  return { ...adm, isAdmin: isAdminEmail(user.email) };
}

/* ------------------------------------------------------------------------ */
/* Postgres row mapping                                                      */
/* ------------------------------------------------------------------------ */

interface UserRow extends Record<string, unknown> {
  id: string;
  name: string;
  email: string;
  mobile: string;
  photo: string | null;
  agent_key: string | null;
  rex_user_id: string | null;
  meta_campaign_id: string | null;
  location: string | null;
  admin_notes: AdminNote[] | null;
  created_at: string | Date;
  password_hash: string;
}

function rowToUser(row: UserRow): StoredUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    mobile: row.mobile,
    photo: row.photo,
    agentKey: row.agent_key,
    rexUserId: row.rex_user_id,
    metaCampaignId: row.meta_campaign_id,
    location: row.location,
    createdAt: new Date(row.created_at).toISOString(),
    passwordHash: row.password_hash,
    adminNotes: Array.isArray(row.admin_notes) ? row.admin_notes : [],
  };
}

/* ------------------------------------------------------------------------ */
/* JSON fallback                                                             */
/* ------------------------------------------------------------------------ */

const FILE = path.join(DATA_DIR, "users.json");

async function readAllFile(): Promise<StoredUser[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredUser[]) : [];
  } catch {
    return [];
  }
}

async function writeAllFile(users: StoredUser[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(users, null, 2), "utf8");
}

/* ------------------------------------------------------------------------ */
/* Store API                                                                 */
/* ------------------------------------------------------------------------ */

export async function findByEmail(email: string): Promise<StoredUser | null> {
  const needle = email.trim().toLowerCase();
  if (hasDb()) {
    const rows = await q<UserRow>("SELECT * FROM users WHERE email = $1", [
      needle,
    ]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }
  const users = await readAllFile();
  return users.find((u) => u.email.toLowerCase() === needle) ?? null;
}

export async function findById(id: string): Promise<StoredUser | null> {
  if (hasDb()) {
    const rows = await q<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }
  const users = await readAllFile();
  return users.find((u) => u.id === id) ?? null;
}

export async function createUser(user: StoredUser): Promise<void> {
  // isAdmin is derived, never stored.
  const { isAdmin: _derived, ...record } = user;
  if (hasDb()) {
    await q(
      `INSERT INTO users
        (id, name, email, mobile, photo, agent_key, rex_user_id,
         meta_campaign_id, location, admin_notes, created_at, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        record.id,
        record.name,
        record.email.toLowerCase(),
        record.mobile,
        record.photo,
        record.agentKey,
        record.rexUserId,
        record.metaCampaignId,
        record.location,
        JSON.stringify(record.adminNotes ?? []),
        record.createdAt,
        record.passwordHash,
      ]
    );
    return;
  }
  const users = await readAllFile();
  users.push(record as StoredUser);
  await writeAllFile(users);
}

/** Read-merge-write of the whole record. Email + createdAt are immutable. */
export async function updateUser(
  id: string,
  patch: Partial<StoredUser>
): Promise<StoredUser | null> {
  const existing = await findById(id);
  if (!existing) return null;
  const {
    isAdmin: _derived,
    email: _email,
    createdAt: _createdAt,
    id: _id,
    ...safePatch
  } = patch;
  const merged: StoredUser = { ...existing, ...safePatch };
  if (hasDb()) {
    await q(
      `UPDATE users SET
         name = $2, mobile = $3, photo = $4, agent_key = $5, rex_user_id = $6,
         meta_campaign_id = $7, location = $8, admin_notes = $9,
         password_hash = $10
       WHERE id = $1`,
      [
        merged.id,
        merged.name,
        merged.mobile,
        merged.photo,
        merged.agentKey,
        merged.rexUserId,
        merged.metaCampaignId,
        merged.location,
        JSON.stringify(merged.adminNotes ?? []),
        merged.passwordHash,
      ]
    );
    return merged;
  }
  const users = await readAllFile();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) return null;
  const { isAdmin: _drop, ...clean } = merged;
  users[idx] = clean as StoredUser;
  await writeAllFile(users);
  return merged;
}

/** Admin list view (adminNotes included, no password hashes), newest first. */
export async function listUsers(): Promise<UserProfile[]> {
  if (hasDb()) {
    const rows = await q<UserRow>(
      "SELECT * FROM users ORDER BY created_at DESC"
    );
    return rows.map((r) => toAdmin(rowToUser(r)));
  }
  const users = await readAllFile();
  return users
    .slice()
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .map(toAdmin);
}
