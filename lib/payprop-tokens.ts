import "server-only";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";
import { hasDb, q } from "@/lib/db";
import type { PayPropAccountId } from "@/lib/payprop";

// PayProp OAuth tokens, one set per agency account.
//
// PayProp uses the authorisation-code grant: someone signs into PayProp once
// and consents, and we keep the refresh token from that. Per their spec the
// refresh token never expires, so this is a one-time connection — the access
// token is minted from it on demand and cached in memory by lib/payprop.ts.
//
// Stored in Postgres wherever it's configured. The obvious home was a JSON
// file beside the uploads, but Railway's filesystem is ephemeral: the token
// was written correctly and then wiped by the next deploy, so the account
// silently disconnected. The file remains the local fallback.

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

interface TokenRow extends Record<string, unknown> {
  refresh_token: string;
  connected_by: string;
  connected_at: string;
  scopes: string | null;
}

export async function getPayPropTokens(
  account: PayPropAccountId
): Promise<PayPropTokens | null> {
  if (hasDb()) {
    const rows = await q<TokenRow>(
      "SELECT refresh_token, connected_by, connected_at, scopes FROM payprop_tokens WHERE account = $1",
      [account]
    ).catch(() => []);
    const r = rows[0];
    return r
      ? {
          refreshToken: r.refresh_token,
          connectedBy: r.connected_by,
          connectedAt: new Date(r.connected_at).toISOString(),
          scopes: r.scopes,
        }
      : null;
  }
  return (await read())[account] ?? null;
}

export async function savePayPropTokens(
  account: PayPropAccountId,
  tokens: PayPropTokens
): Promise<void> {
  if (hasDb()) {
    await q(
      `INSERT INTO payprop_tokens (account, refresh_token, connected_by, connected_at, scopes)
       VALUES ($1, $2, $3, NOW(), $4)
       ON CONFLICT (account) DO UPDATE SET
         refresh_token = EXCLUDED.refresh_token,
         connected_by  = EXCLUDED.connected_by,
         connected_at  = EXCLUDED.connected_at,
         scopes        = EXCLUDED.scopes`,
      [account, tokens.refreshToken, tokens.connectedBy, tokens.scopes ?? null]
    );
    return;
  }
  const store = await read();
  store[account] = tokens;
  await write(store);
}

/** Swap in the rotated refresh token PayProp returns on every refresh. */
export async function updatePayPropRefreshToken(
  account: PayPropAccountId,
  refreshToken: string
): Promise<void> {
  if (hasDb()) {
    await q("UPDATE payprop_tokens SET refresh_token = $2 WHERE account = $1", [
      account,
      refreshToken,
    ]);
    return;
  }
  const store = await read();
  const existing = store[account];
  if (!existing) return;
  store[account] = { ...existing, refreshToken };
  await write(store);
}

export async function clearPayPropTokens(account: PayPropAccountId): Promise<void> {
  if (hasDb()) {
    await q("DELETE FROM payprop_tokens WHERE account = $1", [account]);
    return;
  }
  const store = await read();
  delete store[account];
  await write(store);
}

/** Which accounts have been authorised — for the admin probe. */
export async function connectedPayPropAccounts(): Promise<PayPropAccountId[]> {
  if (hasDb()) {
    const rows = await q<{ account: string }>(
      "SELECT account FROM payprop_tokens"
    ).catch(() => []);
    return rows.map((r) => r.account) as PayPropAccountId[];
  }
  return Object.keys(await read()) as PayPropAccountId[];
}
