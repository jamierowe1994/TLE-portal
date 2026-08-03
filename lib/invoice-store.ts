import "server-only";
import fs from "fs/promises";
import path from "path";
import { DATA_DIR } from "@/lib/data-dir";
import { hasDb, q } from "@/lib/db";

// The agent's own business details for invoicing. Dual backend like the other
// stores: Postgres when DATABASE_URL is set, JSON under DATA_DIR otherwise.

export interface InvoiceProfile {
  businessName: string;
  address: string;
  email: string;
  phone: string;
  vatNumber: string;
  bankDetails: string;
  /** Their share of the management fee, as a percentage. */
  feePercent: number;
  /** Next invoice number to suggest — advanced only when one is issued. */
  nextNumber: number;
}

export const EMPTY_PROFILE: InvoiceProfile = {
  businessName: "",
  address: "",
  email: "",
  phone: "",
  vatNumber: "",
  bankDetails: "",
  // 70% is the going rate per the business, but partners differ and the real
  // splits are not documented yet — so it is a default, never a rule.
  feePercent: 70,
  nextNumber: 1,
};

const FILE = path.join(DATA_DIR, "invoice-profiles.json");

interface Row extends Record<string, unknown> {
  business_name: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  vat_number: string | null;
  bank_details: string | null;
  fee_percent: string | number | null;
  next_number: number | null;
}

function rowTo(r: Row): InvoiceProfile {
  const pct = Number(r.fee_percent);
  return {
    businessName: r.business_name ?? "",
    address: r.address ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    vatNumber: r.vat_number ?? "",
    bankDetails: r.bank_details ?? "",
    feePercent: Number.isFinite(pct) ? pct : EMPTY_PROFILE.feePercent,
    nextNumber: r.next_number ?? 1,
  };
}

export async function getInvoiceProfile(userId: string): Promise<InvoiceProfile> {
  if (hasDb()) {
    const rows = await q<Row>("SELECT * FROM invoice_profiles WHERE user_id = $1", [
      userId,
    ]).catch(() => []);
    return rows[0] ? rowTo(rows[0]) : { ...EMPTY_PROFILE };
  }
  try {
    const all = JSON.parse(await fs.readFile(FILE, "utf8")) as Record<
      string,
      InvoiceProfile
    >;
    return all[userId] ?? { ...EMPTY_PROFILE };
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

export async function saveInvoiceProfile(
  userId: string,
  p: InvoiceProfile
): Promise<InvoiceProfile> {
  // Clamp rather than reject: a percentage outside 0-100 is a typo, and
  // silently invoicing 700% of a fee is the kind of number that gets sent.
  const clean: InvoiceProfile = {
    ...p,
    feePercent: Math.min(100, Math.max(0, Number(p.feePercent) || 0)),
    nextNumber: Math.max(1, Math.floor(Number(p.nextNumber) || 1)),
  };
  if (hasDb()) {
    await q(
      `INSERT INTO invoice_profiles
         (user_id, business_name, address, email, phone, vat_number, bank_details, fee_percent, next_number, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         business_name = $2, address = $3, email = $4, phone = $5,
         vat_number = $6, bank_details = $7, fee_percent = $8,
         next_number = $9, updated_at = NOW()`,
      [
        userId,
        clean.businessName,
        clean.address,
        clean.email,
        clean.phone,
        clean.vatNumber,
        clean.bankDetails,
        clean.feePercent,
        clean.nextNumber,
      ]
    );
    return clean;
  }
  let all: Record<string, InvoiceProfile> = {};
  try {
    all = JSON.parse(await fs.readFile(FILE, "utf8")) as Record<string, InvoiceProfile>;
  } catch {
    /* first write */
  }
  all[userId] = clean;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(all, null, 2), "utf8");
  return clean;
}
