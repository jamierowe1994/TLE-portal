import "server-only";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { Mailbox } from "@/lib/mailbox-store";
import type { DealEmail } from "@/lib/types";

// IMAP reader for the pre-tenancy Emails tab. No local sync: when the tab
// opens we connect to the viewer's own mailbox, search the last 90 days for
// messages to/from the deal's tenant addresses, and return them collapsed
// (subject/from/date + text body for expansion). Read-only — we never write
// to the mailbox.

const SEARCH_DAYS = 90;
const MAX_MESSAGES = 25;
const MAX_BODY_CHARS = 6000;
const CONNECT_TIMEOUT_MS = 12_000;

function client(mb: Mailbox): ImapFlow {
  return new ImapFlow({
    host: mb.imapHost,
    port: mb.imapPort,
    secure: true,
    auth: { user: mb.email, pass: mb.password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
  });
}

/** Try to sign in and immediately disconnect — the "test connection" probe. */
export async function verifyMailbox(mb: Mailbox): Promise<{ ok: boolean; error?: string }> {
  const c = client(mb);
  try {
    await c.connect();
    await c.logout();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not sign in.";
    // imapflow marks bad credentials with authenticationFailed; its generic
    // message ("Command failed") is useless on its own.
    const authFailed =
      (e as { authenticationFailed?: boolean } | null)?.authenticationFailed ||
      /auth|login|credential|command failed/i.test(msg);
    return {
      ok: false,
      error: authFailed
        ? "The mailbox rejected the sign-in — check the address and app password (not your normal password)."
        : `Couldn't reach the mail server (${msg}).`,
    };
  } finally {
    c.close();
  }
}

/* ------------------------------- sending ------------------------------- */

// SMTP host for the same provider as the connected IMAP mailbox — the app
// password already works for both. Falls back to swapping "imap" → "smtp".
function smtpHostFor(imapHost: string): { host: string; port: number; secure: boolean } {
  const h = imapHost.toLowerCase();
  if (h.includes("gmail") || h.includes("googlemail")) {
    return { host: "smtp.gmail.com", port: 465, secure: true };
  }
  if (h.includes("office365") || h.includes("outlook")) {
    return { host: "smtp.office365.com", port: 587, secure: false };
  }
  return { host: imapHost.replace(/^imap/i, "smtp"), port: 465, secure: true };
}

export interface OutgoingAttachment {
  filename: string;
  /** base64-encoded content. */
  content: string;
}

/**
 * Send an email from the connected mailbox. Used by the pre-tenancy Emails
 * tab — Kirstie only ever emails the AGENT, never the tenant, so `to` is the
 * agent's address. Throws on failure; the route turns it into a message.
 */
export async function sendEmail(
  mb: Mailbox,
  msg: { to: string; subject: string; text: string; attachments?: OutgoingAttachment[] }
): Promise<void> {
  const smtp = smtpHostFor(mb.imapHost);
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: mb.email, pass: mb.password },
    connectionTimeout: CONNECT_TIMEOUT_MS,
  });
  await transport.sendMail({
    from: mb.email,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    attachments: (msg.attachments ?? []).map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content, "base64"),
    })),
  });
  transport.close();
}

interface RawText {
  html?: string | Buffer;
  plain?: string | Buffer;
}

function bodyText(text: RawText | undefined): string {
  const plain = text?.plain?.toString().trim();
  if (plain) return plain.slice(0, MAX_BODY_CHARS);
  const html = text?.html?.toString() ?? "";
  // Crude but dependency-free: strip tags for a readable fallback.
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.slice(0, MAX_BODY_CHARS);
}

function addr(list: { address?: string; name?: string }[] | undefined): string {
  if (!list?.length) return "";
  return list
    .map((a) => (a.name ? `${a.name} <${a.address ?? ""}>` : (a.address ?? "")))
    .join(", ");
}

/**
 * Messages in the viewer's mailbox exchanged with any of the given
 * addresses, newest first. Throws on connection/auth failure — the route
 * turns that into a friendly error.
 */
export async function searchEmails(
  mb: Mailbox,
  addresses: string[]
): Promise<DealEmail[]> {
  const wanted = addresses.map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (wanted.length === 0) return [];

  const since = new Date(Date.now() - SEARCH_DAYS * 24 * 60 * 60 * 1000);
  const c = client(mb);
  await c.connect();
  try {
    const out: DealEmail[] = [];
    // Search INBOX (incoming) and the sent folder (outgoing) separately —
    // OR-trees across folders aren't a thing in IMAP.
    const sentBox = await findSentMailbox(c);
    for (const box of ["INBOX", ...(sentBox ? [sentBox] : [])]) {
      const lock = await c.getMailboxLock(box);
      try {
        const uids: number[] = [];
        for (const address of wanted) {
          const or = box === "INBOX" ? { from: address } : { to: address };
          const found = await c.search({ since, ...or }, { uid: true });
          if (Array.isArray(found)) uids.push(...found);
        }
        const unique = [...new Set(uids)].slice(-MAX_MESSAGES);
        if (unique.length === 0) continue;
        for await (const msg of c.fetch(
          unique,
          { uid: true, envelope: true, bodyStructure: false, source: false, bodyParts: ["text"] },
          { uid: true }
        )) {
          const env = msg.envelope;
          const textPart = msg.bodyParts?.get("text");
          out.push({
            id: `${box}:${msg.uid}`,
            subject: env?.subject ?? "(no subject)",
            from: addr(env?.from),
            to: addr(env?.to),
            date: env?.date ? new Date(env.date).toISOString() : null,
            direction: box === "INBOX" ? "in" : "out",
            body: bodyText({ plain: textPart }),
          });
        }
      } finally {
        lock.release();
      }
    }
    out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    return out.slice(0, MAX_MESSAGES);
  } finally {
    await c.logout().catch(() => c.close());
  }
}

/** Best-effort hunt for the provider's sent folder. */
async function findSentMailbox(c: ImapFlow): Promise<string | null> {
  try {
    const boxes = await c.list();
    const bySpecial = boxes.find((b) => b.specialUse === "\\Sent");
    if (bySpecial) return bySpecial.path;
    const byName = boxes.find((b) => /sent/i.test(b.path));
    return byName?.path ?? null;
  } catch {
    return null;
  }
}
