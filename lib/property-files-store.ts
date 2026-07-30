import "server-only";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";

// Files attached to a property — photos, PDFs, whatever the agent drops in
// the drawer. Binaries live on disk under DATA_DIR (which is the persistent
// volume in production), metadata in property-files.json alongside. Metadata
// stays JSON-only on purpose: the binaries need the volume anyway, so a
// Postgres split would just put the index and the data in different places.

export interface PropertyFile {
  id: string;
  listingId: string;
  name: string;
  mime: string;
  size: number;
  uploaderId: string;
  uploaderName: string;
  createdAt: string;
}

export const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB

const META = path.join(DATA_DIR, "property-files.json");
const BIN_DIR = path.join(DATA_DIR, "property-files");

async function readMeta(): Promise<PropertyFile[]> {
  try {
    const raw = await fs.readFile(META, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PropertyFile[]) : [];
  } catch {
    return [];
  }
}

async function writeMeta(files: PropertyFile[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(META, JSON.stringify(files, null, 2), "utf8");
}

const safeName = (name: string) =>
  name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";

export async function listPropertyFiles(listingId: string): Promise<PropertyFile[]> {
  const all = await readMeta();
  return all
    .filter((f) => f.listingId === listingId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addPropertyFile(input: {
  listingId: string;
  name: string;
  mime: string;
  bytes: Buffer;
  uploaderId: string;
  uploaderName: string;
}): Promise<PropertyFile> {
  const file: PropertyFile = {
    id: crypto.randomBytes(10).toString("hex"),
    listingId: input.listingId,
    name: safeName(input.name),
    mime: input.mime || "application/octet-stream",
    size: input.bytes.length,
    uploaderId: input.uploaderId,
    uploaderName: input.uploaderName,
    createdAt: new Date().toISOString(),
  };
  await fs.mkdir(BIN_DIR, { recursive: true });
  await fs.writeFile(path.join(BIN_DIR, file.id), input.bytes);
  const all = await readMeta();
  all.push(file);
  await writeMeta(all);
  return file;
}

export async function getPropertyFile(
  id: string
): Promise<{ meta: PropertyFile; bytes: Buffer } | null> {
  const all = await readMeta();
  const meta = all.find((f) => f.id === id);
  if (!meta) return null;
  try {
    const bytes = await fs.readFile(path.join(BIN_DIR, meta.id));
    return { meta, bytes };
  } catch {
    return null;
  }
}
