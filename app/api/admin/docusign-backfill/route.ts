import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, isAdminEmail } from "@/lib/auth";
import { findById } from "@/lib/users-store";
import { getAgreements, type Agreement } from "@/lib/docusign-agreements";
import { docusignConfigured, getEnvelopeDocument } from "@/lib/docusign";
import {
  MAX_FILE_BYTES,
  addPropertyFile,
  filedEnvelopeKeys,
} from "@/lib/property-files-store";

// Pull every completed TLE agreement out of DocuSign and file it against its
// property, so the signed document sits in the drawer the agent already opens.
//
// DRY RUN BY DEFAULT. It reports exactly what it would do and writes nothing
// until ?commit=1. A backfill that files hundreds of documents is not something
// to trigger by loading a URL to "see what happens".
//
// Idempotent: every filed document records its envelope id, and an envelope
// already on file is skipped. Re-running after a partial failure resumes rather
// than duplicating.
//
// GET /api/admin/docusign-backfill            → dry run: counts + first 20 planned
// GET /api/admin/docusign-backfill?commit=1   → file them (add &limit=N to go gently)
// Optional: &certificates=1 to also pull each completion certificate.
export const maxDuration = 300;

interface Skip {
  envelopeId: string;
  reason: string;
}

export async function GET(req: NextRequest) {
  const adminId = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const admin = adminId ? await findById(adminId) : null;
  if (!admin) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!isAdminEmail(admin.email)) {
    return NextResponse.json(
      { error: "This area is locked to the business owner." },
      { status: 403 }
    );
  }
  if (!docusignConfigured()) {
    return NextResponse.json(
      { error: "DocuSign is not configured. See /api/admin/docusign-probe." },
      { status: 400 }
    );
  }

  const commit = req.nextUrl.searchParams.get("commit") === "1";
  const wantCerts = req.nextUrl.searchParams.get("certificates") === "1";
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "0") || 0;

  const agreements = await getAgreements();
  if (!agreements) {
    return NextResponse.json({
      ready: false,
      hint:
        "The agreements register is still building from REX (a full walk plus " +
        "property lookups). Try again in a minute.",
    });
  }

  // Only completed envelopes have a signed document worth filing. A "sent"
  // envelope would file an unsigned draft and look like a signed agreement.
  const completed = agreements.filter((a) => a.status === "completed");
  const filable = completed.filter((a) => a.listingId);
  const orphaned = completed.filter((a) => !a.listingId);

  const already = await filedEnvelopeKeys();
  const todo = filable.filter((a) => !already.has(`${a.envelopeId}:doc`));

  const summary = {
    register: {
      tleAgreements: agreements.length,
      completed: completed.length,
      filable: filable.length,
      orphaned: orphaned.length,
      properties: new Set(filable.map((a) => a.listingId)).size,
    },
    alreadyFiled: filable.length - todo.length,
    toFile: todo.length,
  };

  if (!commit) {
    return NextResponse.json({
      dryRun: true,
      ...summary,
      note:
        `${orphaned.length} completed agreements have no listing in REX — their ` +
        "property was never listed, so there is no file to put them in. They are " +
        "not lost, just unfilable; they stay visible in the register.",
      planned: todo.slice(0, 20).map((a) => ({
        envelopeId: a.envelopeId,
        listingId: a.listingId,
        subject: a.subject,
        completedAt: a.completedAt,
        signers: a.signers.map((s) => s.name).join(", "),
      })),
      toCommit: `Re-run with ?commit=1 (add &limit=20 for a cautious first pass).`,
    });
  }

  const batch = limit > 0 ? todo.slice(0, limit) : todo;
  let filed = 0;
  let certificates = 0;
  const skipped: Skip[] = [];

  for (const a of batch) {
    try {
      const doc = await getEnvelopeDocument(a.envelopeId, "combined");
      if (doc.bytes.length > MAX_FILE_BYTES) {
        skipped.push({ envelopeId: a.envelopeId, reason: `too large (${doc.bytes.length})` });
        continue;
      }
      await addPropertyFile({
        listingId: a.listingId as string,
        name: `${agreementName(a)}.pdf`,
        mime: doc.mime,
        bytes: doc.bytes,
        // Attributed to DocuSign, not to whichever admin ran the backfill —
        // the drawer should not claim a person uploaded 300 documents.
        uploaderId: "docusign",
        uploaderName: "DocuSign",
        source: "docusign",
        envelopeId: a.envelopeId,
      });
      filed++;

      if (wantCerts && !already.has(`${a.envelopeId}:cert`)) {
        const cert = await getEnvelopeDocument(a.envelopeId, "certificate").catch(
          () => null
        );
        if (cert && cert.bytes.length <= MAX_FILE_BYTES) {
          await addPropertyFile({
            listingId: a.listingId as string,
            name: `${agreementName(a)} — certificate of completion.pdf`,
            mime: cert.mime,
            bytes: cert.bytes,
            uploaderId: "docusign",
            uploaderName: "DocuSign",
            source: "docusign",
            envelopeId: a.envelopeId,
            isCertificate: true,
          });
          certificates++;
        }
      }
    } catch (err) {
      // One bad envelope must not abandon the other 300. Re-running resumes.
      skipped.push({ envelopeId: a.envelopeId, reason: (err as Error).message });
    }
  }

  return NextResponse.json({
    dryRun: false,
    ...summary,
    filed,
    certificates,
    skipped: skipped.length,
    skippedDetail: skipped.slice(0, 20),
    remaining: todo.length - filed,
  });
}

/** A filename that reads as a document, not a GUID. */
function agreementName(a: Agreement): string {
  const subject = a.subject
    .replace(/^(please|complete with)\s+docusign:?\s*/i, "")
    .replace(/^requesting your signature for\s*/i, "")
    .replace(/\.(pdf|docx?)$/i, "")
    .trim();
  const date = a.completedAt ? a.completedAt.slice(0, 10) : "undated";
  return `${subject || "Signed agreement"} (${date})`;
}
