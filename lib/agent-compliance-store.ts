import "server-only";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";

// The agent's OWN compliance — the certificates a TLE partner has to hold and
// renew, not the property paperwork in REX. Uploaded on their profile, and
// visible to head office in the admin centre.
//
// Binaries live on disk under DATA_DIR (the persistent volume in production),
// metadata alongside in JSON. Same reasoning as property-files: the volume is
// needed for the bytes anyway, so splitting the index into Postgres would only
// separate the two halves.

/** The certificates every partner is expected to hold. */
export const AGENT_COMPLIANCE_TYPES = [
  { key: "pi-insurance", label: "Professional indemnity insurance", renews: true },
  { key: "client-money", label: "Client money protection", renews: true },
  { key: "redress", label: "Property redress scheme", renews: true },
  { key: "ico", label: "ICO registration", renews: true },
  { key: "aml", label: "Anti-money-laundering supervision", renews: true },
  { key: "propertymark", label: "Propertymark / qualification", renews: false },
  { key: "other", label: "Something else", renews: false },
] as const;

export type AgentComplianceType = (typeof AGENT_COMPLIANCE_TYPES)[number]["key"];

export interface AgentComplianceDoc {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  type: AgentComplianceType;
  /** Free-text label when type is "other". */
  label: string;
  name: string;
  mime: string;
  size: number;
  /** When it lapses — drives the renewal reminder. */
  expiry: string | null;
  createdAt: string;
}

export const MAX_AGENT_DOC_BYTES = 15 * 1024 * 1024; // 15MB

const META = path.join(DATA_DIR, "agent-compliance.json");
const BIN_DIR = path.join(DATA_DIR, "agent-compliance");

async function readMeta(): Promise<AgentComplianceDoc[]> {
  try {
    const raw = await fs.readFile(META, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AgentComplianceDoc[]) : [];
  } catch {
    return [];
  }
}

async function writeMeta(docs: AgentComplianceDoc[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(META, JSON.stringify(docs, null, 2), "utf8");
}

const safeName = (name: string) =>
  name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";

/** One agent's documents, newest first. */
export async function listAgentCompliance(userId: string): Promise<AgentComplianceDoc[]> {
  const all = await readMeta();
  return all
    .filter((d) => d.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Everyone's, for the admin centre. */
export async function listAllAgentCompliance(): Promise<AgentComplianceDoc[]> {
  const all = await readMeta();
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addAgentCompliance(input: {
  userId: string;
  userName: string;
  userEmail: string;
  type: AgentComplianceType;
  label: string;
  name: string;
  mime: string;
  bytes: Buffer;
  expiry: string | null;
}): Promise<AgentComplianceDoc> {
  const doc: AgentComplianceDoc = {
    id: crypto.randomBytes(10).toString("hex"),
    userId: input.userId,
    userName: input.userName,
    userEmail: input.userEmail,
    type: input.type,
    label: input.label,
    name: safeName(input.name),
    mime: input.mime || "application/octet-stream",
    size: input.bytes.length,
    expiry: input.expiry,
    createdAt: new Date().toISOString(),
  };
  await fs.mkdir(BIN_DIR, { recursive: true });
  await fs.writeFile(path.join(BIN_DIR, doc.id), input.bytes);
  const all = await readMeta();
  all.push(doc);
  await writeMeta(all);
  return doc;
}

export async function getAgentComplianceFile(
  id: string
): Promise<{ meta: AgentComplianceDoc; bytes: Buffer } | null> {
  const all = await readMeta();
  const meta = all.find((d) => d.id === id);
  if (!meta) return null;
  try {
    const bytes = await fs.readFile(path.join(BIN_DIR, meta.id));
    return { meta, bytes };
  } catch {
    return null;
  }
}

export async function deleteAgentCompliance(id: string, userId: string): Promise<boolean> {
  const all = await readMeta();
  const doc = all.find((d) => d.id === id);
  // Only the owner can remove their own certificate.
  if (!doc || doc.userId !== userId) return false;
  await writeMeta(all.filter((d) => d.id !== id));
  await fs.rm(path.join(BIN_DIR, id), { force: true });
  return true;
}
