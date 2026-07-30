import "server-only";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";
import type { PayPropAccountId } from "@/lib/payprop";

// PayProp OAuth tokens, one set per agency account.
//
// PayProp uses the authorisation-code grant: someone signs into PayProp once
// and consents, and we keep the refresh token from that. Per their spec the
// refresh token never expires, so this is a one-time connection — the access
// token is minted from it on demand and cached in memory by lib/payprop.ts.
//
// Stored on the data volume rather than in Postgres for the same reason as
// the uploads: it has to survive a redeploy, and there is exactly one row.

export interface PayPropTokens {
  refreshToken: string;
  /** Who authorised it and when — shown in the admin probe. */
  connectedBy: string;
  connectedAt: string;
  /** Scopes PayProp granted, when it tells us. */
  scopes?: string | null;
}

const FILE = path.join(DATA_DIR, "payprop-tokens.json");

type Store = Partial<Record<PayPropAccountId, PayPropTokens>>;

async function read(): Promise<Store> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

async function write(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(store, null, 2), "utf8");
}

export async function getPayPropTokens(
  account: PayPropAccountId
): Promise<PayPropTokens | null> {
  return (await read())[account] ?? null;
}

export async function savePayPropTokens(
  account: PayPropAccountId,
  tokens: PayPropTokens
): Promise<void> {
  const store = await read();
  store[account] = tokens;
  await write(store);
}

/** Swap in the rotated refresh token PayProp returns on every refresh. */
export async function updatePayPropRefreshToken(
  account: PayPropAccountId,
  refreshToken: string
): Promise<void> {
  const store = await read();
  const existing = store[account];
  if (!existing) return;
  store[account] = { ...existing, refreshToken };
  await write(store);
}

export async function clearPayPropTokens(account: PayPropAccountId): Promise<void> {
  const store = await read();
  delete store[account];
  await write(store);
}

/** Which accounts have been authorised — for the admin probe. */
export async function connectedPayPropAccounts(): Promise<PayPropAccountId[]> {
  return Object.keys(await read()) as PayPropAccountId[];
}
