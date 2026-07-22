import "server-only";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { DATA_DIR } from "@/lib/data-dir";
import { hasDb, q } from "@/lib/db";
import type { MailboxStatus } from "@/lib/types";

// Per-user IMAP mailbox credentials for the pre-tenancy Emails tab.
// The app password is AES-256-GCM encrypted with a key derived from
// AUTH_SECRET — the JSON file / DB row never holds it in the clear, and the
// client only ever receives MailboxStatus (no secret material).

export interface Mailbox {
  userId: string;
  email: string;
  imapHost: string;
  imapPort: number;
  password: string; // decrypted, in memory only
}

interface StoredMailbox {
  userId: string;
  email: string;
  imapHost: string;
  imapPort: number;
  secret: string; // iv:tag:ciphertext, hex
  updatedAt: string;
}

/* ------------------------------- crypto ------------------------------- */

function key(): Buffer {
  const secret = process.env.AUTH_SECRET ?? "dev-only-secret-change-me-in-production";
  return crypto.scryptSync(secret, "tle-mailbox", 32);
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

function decrypt(secret: string): string | null {
  try {
    const [iv, tag, data] = secret.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(data, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return null; // AUTH_SECRET rotated — the user just reconnects
  }
}

/* -------------------------------- store -------------------------------- */

const FILE = path.join(DATA_DIR, "mailboxes.json");

async function readAllFile(): Promise<StoredMailbox[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(FILE, "utf8"));
    return Array.isArray(parsed) ? (parsed as StoredMailbox[]) : [];
  } catch {
    return [];
  }
}

async function writeAllFile(rows: StoredMailbox[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(rows, null, 2), "utf8");
}

export async function getMailbox(userId: string): Promise<Mailbox | null> {
  let stored: StoredMailbox | null = null;
  if (hasDb()) {
    const rows = await q<Record<string, unknown>>(
      "SELECT * FROM user_mailboxes WHERE user_id = $1",
      [userId]
    );
    if (rows[0]) {
      stored = {
        userId: String(rows[0].user_id),
        email: String(rows[0].email),
        imapHost: String(rows[0].imap_host),
        imapPort: Number(rows[0].imap_port),
        secret: String(rows[0].secret),
        updatedAt: new Date(rows[0].updated_at as string).toISOString(),
      };
    }
  } else {
    stored = (await readAllFile()).find((m) => m.userId === userId) ?? null;
  }
  if (!stored) return null;
  const password = decrypt(stored.secret);
  if (password == null) return null;
  return {
    userId: stored.userId,
    email: stored.email,
    imapHost: stored.imapHost,
    imapPort: stored.imapPort,
    password,
  };
}

export async function saveMailbox(mb: Mailbox): Promise<void> {
  const secret = encrypt(mb.password);
  const updatedAt = new Date().toISOString();
  if (hasDb()) {
    await q(
      `INSERT INTO user_mailboxes (user_id, email, imap_host, imap_port, secret, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id) DO UPDATE SET
         email = $2, imap_host = $3, imap_port = $4, secret = $5, updated_at = $6`,
      [mb.userId, mb.email, mb.imapHost, mb.imapPort, secret, updatedAt]
    );
    return;
  }
  const all = await readAllFile();
  const next = all.filter((m) => m.userId !== mb.userId);
  next.push({
    userId: mb.userId,
    email: mb.email,
    imapHost: mb.imapHost,
    imapPort: mb.imapPort,
    secret,
    updatedAt,
  });
  await writeAllFile(next);
}

export async function deleteMailbox(userId: string): Promise<void> {
  if (hasDb()) {
    await q("DELETE FROM user_mailboxes WHERE user_id = $1", [userId]);
    return;
  }
  await writeAllFile((await readAllFile()).filter((m) => m.userId !== userId));
}

export async function mailboxStatus(userId: string): Promise<MailboxStatus> {
  const mb = await getMailbox(userId);
  return mb
    ? { connected: true, email: mb.email, imapHost: mb.imapHost }
    : { connected: false };
}
