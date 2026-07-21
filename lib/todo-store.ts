import "server-only";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";
import { hasDb, q } from "@/lib/db";

// To-do store — the agent's own reminders. Created by hand on the To-dos
// page or by the TLE Assistant mid-conversation ("remind me to chase the
// EPC at Marine Parade on Friday"). Each item can carry a due date/time,
// the platform it happens on (REX, Propoly, PayProp…), and the property /
// tenant it relates to.
//
// Dual backend like the other stores: Postgres (`todos`, schema in
// lib/db.ts) when DATABASE_URL is set, otherwise todos.json under DATA_DIR.

export interface Todo {
  id: string;
  userId: string;
  note: string;
  dueAt: string | null; // ISO datetime or date — display-parsed, not enforced
  platform: string | null;
  property: string | null;
  tenant: string | null;
  done: boolean;
  createdAt: string;
  updatedAt: string;
}

const MAX_NOTE = 1000;
const MAX_FIELD = 200;

const clamp = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/* ------------------------------------------------------------------------ */
/* Postgres                                                                  */
/* ------------------------------------------------------------------------ */

interface TodoRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  note: string;
  due_at: string | null;
  platform: string | null;
  property: string | null;
  tenant: string | null;
  done: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

function rowToTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    userId: row.user_id,
    note: row.note,
    dueAt: row.due_at,
    platform: row.platform,
    property: row.property,
    tenant: row.tenant,
    done: row.done,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/* ------------------------------------------------------------------------ */
/* JSON fallback                                                             */
/* ------------------------------------------------------------------------ */

const FILE = path.join(DATA_DIR, "todos.json");

async function readAllFile(): Promise<Todo[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Todo[]) : [];
  } catch {
    return [];
  }
}

async function writeAllFile(rows: Todo[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(rows, null, 2), "utf8");
}

/* ------------------------------------------------------------------------ */
/* Store API — every call is scoped to one user                              */
/* ------------------------------------------------------------------------ */

/** All of one agent's to-dos: open first (soonest due, undated last), then done. */
export async function listTodos(userId: string): Promise<Todo[]> {
  let rows: Todo[];
  if (hasDb()) {
    rows = (
      await q<TodoRow>("SELECT * FROM todos WHERE user_id = $1", [userId])
    ).map(rowToTodo);
  } else {
    rows = (await readAllFile()).filter((t) => t.userId === userId);
  }
  return rows.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const da = a.dueAt ?? "9999";
    const db = b.dueAt ?? "9999";
    if (da !== db) return da.localeCompare(db);
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export async function createTodo(
  userId: string,
  input: {
    note: string;
    dueAt?: string | null;
    platform?: string | null;
    property?: string | null;
    tenant?: string | null;
  }
): Promise<Todo> {
  const note = clamp(input.note, MAX_NOTE);
  if (!note) throw new Error("A to-do needs a note.");
  const now = new Date().toISOString();
  const todo: Todo = {
    id: crypto.randomUUID(),
    userId,
    note,
    dueAt: clamp(input.dueAt, MAX_FIELD),
    platform: clamp(input.platform, MAX_FIELD),
    property: clamp(input.property, MAX_FIELD),
    tenant: clamp(input.tenant, MAX_FIELD),
    done: false,
    createdAt: now,
    updatedAt: now,
  };

  if (hasDb()) {
    await q(
      `INSERT INTO todos (id, user_id, note, due_at, platform, property, tenant, done, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, NOW(), NOW())`,
      [todo.id, userId, todo.note, todo.dueAt, todo.platform, todo.property, todo.tenant]
    );
    return todo;
  }

  const rows = await readAllFile();
  rows.push(todo);
  await writeAllFile(rows);
  return todo;
}

/** Patch one of the user's to-dos. Only provided fields change. */
export async function updateTodo(
  userId: string,
  id: string,
  patch: {
    note?: string;
    dueAt?: string | null;
    platform?: string | null;
    property?: string | null;
    tenant?: string | null;
    done?: boolean;
  }
): Promise<Todo | null> {
  const apply = (t: Todo): Todo => ({
    ...t,
    note: patch.note !== undefined ? (clamp(patch.note, MAX_NOTE) ?? t.note) : t.note,
    dueAt: patch.dueAt !== undefined ? clamp(patch.dueAt, MAX_FIELD) : t.dueAt,
    platform: patch.platform !== undefined ? clamp(patch.platform, MAX_FIELD) : t.platform,
    property: patch.property !== undefined ? clamp(patch.property, MAX_FIELD) : t.property,
    tenant: patch.tenant !== undefined ? clamp(patch.tenant, MAX_FIELD) : t.tenant,
    done: patch.done !== undefined ? patch.done === true : t.done,
    updatedAt: new Date().toISOString(),
  });

  if (hasDb()) {
    const rows = await q<TodoRow>(
      "SELECT * FROM todos WHERE id = $1 AND user_id = $2",
      [id, userId]
    );
    if (rows.length === 0) return null;
    const next = apply(rowToTodo(rows[0]));
    await q(
      `UPDATE todos SET note=$3, due_at=$4, platform=$5, property=$6, tenant=$7, done=$8, updated_at=NOW()
       WHERE id = $1 AND user_id = $2`,
      [id, userId, next.note, next.dueAt, next.platform, next.property, next.tenant, next.done]
    );
    return next;
  }

  const rows = await readAllFile();
  const idx = rows.findIndex((t) => t.id === id && t.userId === userId);
  if (idx < 0) return null;
  rows[idx] = apply(rows[idx]);
  await writeAllFile(rows);
  return rows[idx];
}

export async function deleteTodo(userId: string, id: string): Promise<boolean> {
  if (hasDb()) {
    const rows = await q<{ id: string }>(
      "DELETE FROM todos WHERE id = $1 AND user_id = $2 RETURNING id",
      [id, userId]
    );
    return rows.length > 0;
  }
  const rows = await readAllFile();
  const next = rows.filter((t) => !(t.id === id && t.userId === userId));
  if (next.length === rows.length) return false;
  await writeAllFile(next);
  return true;
}
