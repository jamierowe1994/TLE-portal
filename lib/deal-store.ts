import "server-only";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { DATA_DIR } from "@/lib/data-dir";
import { hasDb, q } from "@/lib/db";
import type {
  ChecklistTick,
  DealMeta,
  DealNote,
  DealNoteKind,
  DealNoteRole,
  DealPortalOverlay,
  DealTask,
} from "@/lib/types";
import { CHECKLIST_ITEMS, portalStageOf } from "@/lib/propoly-stages";

// Pre-tenancy overlay store — the portal-owned data layered onto Propoly
// deals: two-way notes (Kirstie ↔ agent), her manual stage moves and the
// checklist ticks. Dual backend like users-store: Postgres when DATABASE_URL
// is set, otherwise JSON files under DATA_DIR.

/* ------------------------------------------------------------------------ */
/* JSON fallback                                                             */
/* ------------------------------------------------------------------------ */

const NOTES_FILE = path.join(DATA_DIR, "deal-notes.json");
const META_FILE = path.join(DATA_DIR, "deal-meta.json");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

/* ------------------------------------------------------------------------ */
/* Row mapping                                                               */
/* ------------------------------------------------------------------------ */

interface NoteRow extends Record<string, unknown> {
  id: string;
  deal_id: string;
  author_id: string;
  author_name: string;
  author_role: string;
  kind: string | null;
  text: string;
  created_at: string | Date;
}

function rowToNote(r: NoteRow): DealNote {
  return {
    id: r.id,
    dealId: r.deal_id,
    authorId: r.author_id,
    authorName: r.author_name,
    authorRole: r.author_role as DealNoteRole,
    kind: (r.kind ?? "note") as DealNoteKind,
    text: r.text,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

interface TaskRow extends Record<string, unknown> {
  id: string;
  deal_id: string;
  deal_label: string;
  user_id: string;
  title: string;
  due_date: string | null;
  done: boolean;
  created_at: string | Date;
  completed_at: string | Date | null;
}

function rowToTask(r: TaskRow): DealTask {
  return {
    id: r.id,
    dealId: r.deal_id,
    dealLabel: r.deal_label,
    userId: r.user_id,
    title: r.title,
    dueDate: r.due_date,
    done: !!r.done,
    createdAt: new Date(r.created_at).toISOString(),
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
  };
}

interface MetaRow extends Record<string, unknown> {
  unarchived_at?: string | Date | null;
  deal_id: string;
  stage_override: string | null;
  stage_based_on: string | null;
  stage_by: string | null;
  stage_at: string | Date | null;
  checklist: Record<string, ChecklistTick> | null;
  updated_at: string | Date;
}

function rowToMeta(r: MetaRow): DealMeta {
  return {
    dealId: r.deal_id,
    stageOverride: r.stage_override,
    stageBasedOn: r.stage_based_on,
    stageBy: r.stage_by,
    stageAt: r.stage_at ? new Date(r.stage_at).toISOString() : null,
    checklist: r.checklist && typeof r.checklist === "object" ? r.checklist : {},
    unarchivedAt: r.unarchived_at ? new Date(r.unarchived_at).toISOString() : null,
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function emptyMeta(dealId: string): DealMeta {
  return {
    dealId,
    stageOverride: null,
    stageBasedOn: null,
    stageBy: null,
    stageAt: null,
    checklist: {},
    updatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------------ */
/* Notes                                                                     */
/* ------------------------------------------------------------------------ */

async function allNotesForDeal(dealId: string): Promise<DealNote[]> {
  if (hasDb()) {
    const rows = await q<NoteRow>(
      "SELECT * FROM deal_notes WHERE deal_id = $1 ORDER BY created_at ASC",
      [dealId]
    );
    return rows.map(rowToNote);
  }
  const all = await readJson<DealNote[]>(NOTES_FILE, []);
  return all
    .filter((n) => n.dealId === dealId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * The deal's notes as one viewer may see them: shared notes + system events
 * for everyone, private notes only when the viewer wrote them.
 */
export async function listNotes(
  dealId: string,
  viewerId?: string
): Promise<{ activity: DealNote[]; privateNotes: DealNote[] }> {
  const all = await allNotesForDeal(dealId);
  return {
    activity: all.filter((n) => (n.kind ?? "note") !== "private"),
    privateNotes: viewerId
      ? all.filter((n) => n.kind === "private" && n.authorId === viewerId)
      : [],
  };
}

export async function addNote(note: {
  dealId: string;
  authorId: string;
  authorName: string;
  authorRole: DealNoteRole;
  kind?: DealNoteKind;
  text: string;
}): Promise<DealNote> {
  const full: DealNote = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    kind: "note",
    ...note,
  };
  if (hasDb()) {
    await q(
      `INSERT INTO deal_notes (id, deal_id, author_id, author_name, author_role, kind, text, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [full.id, full.dealId, full.authorId, full.authorName, full.authorRole, full.kind, full.text, full.createdAt]
    );
    return full;
  }
  const all = await readJson<DealNote[]>(NOTES_FILE, []);
  all.push(full);
  await writeJson(NOTES_FILE, all);
  return full;
}

/** Auto-logged activity line ("moved stage", "ticked checklist item", …). */
export async function logSystemEvent(
  dealId: string,
  actor: { id: string; name: string; role: DealNoteRole },
  text: string
): Promise<void> {
  await addNote({
    dealId,
    authorId: actor.id,
    authorName: actor.name,
    authorRole: actor.role,
    kind: "system",
    text,
  });
}

/* ------------------------------------------------------------------------ */
/* Tasks (follow-ups)                                                        */
/* ------------------------------------------------------------------------ */

const TASKS_FILE = path.join(DATA_DIR, "deal-tasks.json");

export async function listTasksForDeal(dealId: string): Promise<DealTask[]> {
  if (hasDb()) {
    const rows = await q<TaskRow>(
      "SELECT * FROM deal_tasks WHERE deal_id = $1 ORDER BY done ASC, due_date ASC NULLS LAST, created_at ASC",
      [dealId]
    );
    return rows.map(rowToTask);
  }
  const all = await readJson<DealTask[]>(TASKS_FILE, []);
  return all
    .filter((t) => t.dealId === dealId)
    .sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
        a.createdAt.localeCompare(b.createdAt)
    );
}

/** The viewer's own follow-ups, optionally only those due on one date. */
export async function listTasksForUser(
  userId: string,
  dueDate?: string
): Promise<DealTask[]> {
  if (hasDb()) {
    const rows = dueDate
      ? await q<TaskRow>(
          "SELECT * FROM deal_tasks WHERE user_id = $1 AND due_date = $2 ORDER BY done ASC, created_at ASC",
          [userId, dueDate]
        )
      : await q<TaskRow>(
          "SELECT * FROM deal_tasks WHERE user_id = $1 ORDER BY done ASC, due_date ASC NULLS LAST",
          [userId]
        );
    return rows.map(rowToTask);
  }
  const all = await readJson<DealTask[]>(TASKS_FILE, []);
  return all
    .filter((t) => t.userId === userId && (!dueDate || t.dueDate === dueDate))
    .sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")
    );
}

export async function addTask(task: {
  dealId: string;
  dealLabel: string;
  userId: string;
  title: string;
  dueDate: string | null;
}): Promise<DealTask> {
  const full: DealTask = {
    id: crypto.randomUUID(),
    done: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...task,
  };
  if (hasDb()) {
    await q(
      `INSERT INTO deal_tasks (id, deal_id, deal_label, user_id, title, due_date, done, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,FALSE,$7)`,
      [full.id, full.dealId, full.dealLabel, full.userId, full.title, full.dueDate, full.createdAt]
    );
    return full;
  }
  const all = await readJson<DealTask[]>(TASKS_FILE, []);
  all.push(full);
  await writeJson(TASKS_FILE, all);
  return full;
}

/** Toggle done. Only the task's owner may change it; returns null otherwise. */
export async function setTaskDone(
  taskId: string,
  userId: string,
  done: boolean
): Promise<DealTask | null> {
  const completedAt = done ? new Date().toISOString() : null;
  if (hasDb()) {
    const rows = await q<TaskRow>(
      "UPDATE deal_tasks SET done = $3, completed_at = $4 WHERE id = $1 AND user_id = $2 RETURNING *",
      [taskId, userId, done, completedAt]
    );
    return rows[0] ? rowToTask(rows[0]) : null;
  }
  const all = await readJson<DealTask[]>(TASKS_FILE, []);
  const task = all.find((t) => t.id === taskId && t.userId === userId);
  if (!task) return null;
  task.done = done;
  task.completedAt = completedAt;
  await writeJson(TASKS_FILE, all);
  return task;
}

/* ------------------------------------------------------------------------ */
/* Meta (stage override + checklist)                                         */
/* ------------------------------------------------------------------------ */

export async function getMeta(dealId: string): Promise<DealMeta> {
  if (hasDb()) {
    const rows = await q<MetaRow>("SELECT * FROM deal_meta WHERE deal_id = $1", [dealId]);
    return rows[0] ? rowToMeta(rows[0]) : emptyMeta(dealId);
  }
  const all = await readJson<Record<string, DealMeta>>(META_FILE, {});
  return all[dealId] ?? emptyMeta(dealId);
}

async function saveMeta(meta: DealMeta): Promise<void> {
  meta.updatedAt = new Date().toISOString();
  if (hasDb()) {
    await q(
      `INSERT INTO deal_meta (deal_id, stage_override, stage_based_on, stage_by, stage_at, checklist, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (deal_id) DO UPDATE SET
         stage_override = $2, stage_based_on = $3, stage_by = $4,
         stage_at = $5, checklist = $6, updated_at = $7`,
      [
        meta.dealId,
        meta.stageOverride,
        meta.stageBasedOn,
        meta.stageBy,
        meta.stageAt,
        JSON.stringify(meta.checklist),
        meta.updatedAt,
      ]
    );
    return;
  }
  const all = await readJson<Record<string, DealMeta>>(META_FILE, {});
  all[meta.dealId] = meta;
  await writeJson(META_FILE, all);
}

/**
 * Move the deal to a PORTAL stage (or null to hand back to Propoly's live
 * status). Moving it to exactly where Propoly already puts it clears the
 * override rather than storing a no-op.
 */
export async function setStageOverride(
  dealId: string,
  stageKey: string | null,
  liveStatusKey: string,
  byName: string
): Promise<DealMeta> {
  const meta = await getMeta(dealId);
  if (stageKey === null || stageKey === portalStageOf(liveStatusKey)) {
    meta.stageOverride = null;
    meta.stageBasedOn = null;
    meta.stageBy = null;
    meta.stageAt = null;
  } else {
    meta.stageOverride = stageKey;
    meta.stageBasedOn = liveStatusKey; // a later live change invalidates the move
    meta.stageBy = byName;
    meta.stageAt = new Date().toISOString();
  }
  await saveMeta(meta);
  return meta;
}

export async function setChecklistItem(
  dealId: string,
  itemKey: string,
  done: boolean,
  byName: string
): Promise<DealMeta> {
  const meta = await getMeta(dealId);
  meta.checklist = {
    ...meta.checklist,
    [itemKey]: { done, by: byName, at: new Date().toISOString() },
  };
  await saveMeta(meta);
  return meta;
}

/* ------------------------------------------------------------------------ */
/* Overlay assembly (both dashboards render from this)                       */
/* ------------------------------------------------------------------------ */

/**
 * The PORTAL stage a deal displays at: Kirstie's move while it still
 * applies, otherwise the live Propoly status mapped onto the 8-stage portal
 * pipeline. Her override records the raw status it was based on — if
 * Propoly has since moved the deal itself, the live system wins and the
 * move is stale.
 */
/**
 * Pull a deal out of the archive, or drop it back in.
 *
 * The archive is a rule — move-in slipped more than 30 days — so only the
 * EXCEPTION is stored. Writing a row for every deal the moment it aged past
 * the threshold would mean a table that grows with time rather than with what
 * anyone actually did.
 */
export async function setUnarchived(dealId: string, on: boolean): Promise<DealMeta> {
  if (!hasDb()) return emptyMeta(dealId);
  await q(
    `INSERT INTO deal_meta (deal_id, unarchived_at, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (deal_id) DO UPDATE SET unarchived_at = EXCLUDED.unarchived_at, updated_at = NOW()`,
    [dealId, on ? new Date().toISOString() : null]
  );
  return getMeta(dealId);
}

export function effectivePortalStage(liveStatusKey: string, meta: DealMeta | null): string {
  if (meta?.stageOverride && meta.stageBasedOn === liveStatusKey) {
    return meta.stageOverride;
  }
  return portalStageOf(liveStatusKey);
}

export function checklistDoneCount(meta: DealMeta | null): number {
  if (!meta) return 0;
  return CHECKLIST_ITEMS.filter((i) => meta.checklist[i.key]?.done).length;
}

/** Batch overlays for a list of deal ids (one query each way, not N). */
export async function getOverlays(
  dealIds: string[]
): Promise<Map<string, { meta: DealMeta; overlay: DealPortalOverlay }>> {
  const result = new Map<string, { meta: DealMeta; overlay: DealPortalOverlay }>();
  if (dealIds.length === 0) return result;

  let metas: DealMeta[];
  let notes: DealNote[];
  if (hasDb()) {
    const [metaRows, noteRows] = await Promise.all([
      q<MetaRow>("SELECT * FROM deal_meta WHERE deal_id = ANY($1)", [dealIds]),
      q<NoteRow>(
        "SELECT * FROM deal_notes WHERE deal_id = ANY($1) ORDER BY created_at ASC",
        [dealIds]
      ),
    ]);
    metas = metaRows.map(rowToMeta);
    notes = noteRows.map(rowToNote);
  } else {
    const idSet = new Set(dealIds);
    const [metaMap, allNotes] = await Promise.all([
      readJson<Record<string, DealMeta>>(META_FILE, {}),
      readJson<DealNote[]>(NOTES_FILE, []),
    ]);
    metas = Object.values(metaMap).filter((m) => idSet.has(m.dealId));
    notes = allNotes
      .filter((n) => idSet.has(n.dealId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  const metaById = new Map(metas.map((m) => [m.dealId, m]));
  const notesById = new Map<string, DealNote[]>();
  for (const n of notes) {
    // Overlay counts are the human conversation only — system events aren't
    // messages, and private notes must never leak into anyone else's badge.
    if ((n.kind ?? "note") !== "note") continue;
    (notesById.get(n.dealId) ?? notesById.set(n.dealId, []).get(n.dealId)!).push(n);
  }

  for (const id of dealIds) {
    const meta = metaById.get(id) ?? emptyMeta(id);
    const dealNotes = notesById.get(id) ?? [];
    const last = dealNotes[dealNotes.length - 1] ?? null;
    result.set(id, {
      meta,
      overlay: {
        notesCount: dealNotes.length,
        lastNote: last
          ? {
              text: last.text,
              authorName: last.authorName,
              authorRole: last.authorRole,
              at: last.createdAt,
            }
          : null,
        override: meta.stageOverride
          ? { stageKey: meta.stageOverride, by: meta.stageBy ?? "", at: meta.stageAt ?? "" }
          : null,
        checklistDone: checklistDoneCount(meta),
        checklistTotal: CHECKLIST_ITEMS.length,
      },
    });
  }
  return result;
}
