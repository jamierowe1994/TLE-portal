import "server-only";
import { getEnvelopeDocument } from "@/lib/docusign";
import {
  MAX_FILE_BYTES,
  addPropertyFile,
  filedEnvelopeKeys,
} from "@/lib/property-files-store";
import type { Agreement } from "@/lib/docusign-agreements";

// Putting one signed agreement into one property file.
//
// Shared deliberately: the backfill walks history and the Connect webhook
// handles the live one, and if those two ever disagreed about naming, dedupe
// or attribution you would get the same agreement filed twice under two
// different names. One function, one behaviour.

export interface FileResult {
  filed: boolean;
  certificate: boolean;
  /** Why nothing was filed. Absent when it was. */
  reason?: string;
}

/** A filename that reads as a document, not a GUID. */
export function agreementName(a: Pick<Agreement, "subject" | "completedAt">): string {
  const subject = a.subject
    .replace(/^(please|complete with)\s+docusign:?\s*/i, "")
    .replace(/^requesting your signature for\s*/i, "")
    .replace(/\.(pdf|docx?)$/i, "")
    .trim();
  const date = a.completedAt ? a.completedAt.slice(0, 10) : "undated";
  return `${subject || "Signed agreement"} (${date})`;
}

/**
 * Download an agreement's signed PDF and file it against its property.
 *
 * Idempotent: an envelope already on file is skipped, so a re-run after a
 * partial failure resumes rather than duplicating. Pass `already` when filing
 * in a loop, so the whole index isn't re-read once per envelope.
 */
export async function fileAgreement(
  a: Agreement,
  opts: { certificates?: boolean; already?: Set<string> } = {}
): Promise<FileResult> {
  if (a.status !== "completed") {
    // A "sent" envelope has no signature on it. Filing one would put an
    // unsigned draft in the file looking exactly like a signed agreement.
    return { filed: false, certificate: false, reason: `status is ${a.status}` };
  }
  if (!a.listingId) {
    return { filed: false, certificate: false, reason: "no listing to file against" };
  }
  const already = opts.already ?? (await filedEnvelopeKeys());
  if (already.has(`${a.envelopeId}:doc`)) {
    return { filed: false, certificate: false, reason: "already filed" };
  }

  const doc = await getEnvelopeDocument(a.envelopeId, "combined");
  if (doc.bytes.length > MAX_FILE_BYTES) {
    return {
      filed: false,
      certificate: false,
      reason: `too large (${doc.bytes.length} bytes)`,
    };
  }
  const name = agreementName(a);
  await addPropertyFile({
    listingId: a.listingId,
    name: `${name}.pdf`,
    mime: doc.mime,
    bytes: doc.bytes,
    // Attributed to DocuSign, not to whoever triggered the run — the drawer
    // must not claim a person uploaded three hundred documents.
    uploaderId: "docusign",
    uploaderName: "DocuSign",
    source: "docusign",
    envelopeId: a.envelopeId,
  });
  already.add(`${a.envelopeId}:doc`);

  let certificate = false;
  if (opts.certificates && !already.has(`${a.envelopeId}:cert`)) {
    // The certificate of completion is the audit trail — who signed, when,
    // from which IP. Optional: it doubles the file count in the drawer.
    const cert = await getEnvelopeDocument(a.envelopeId, "certificate").catch(() => null);
    if (cert && cert.bytes.length <= MAX_FILE_BYTES) {
      await addPropertyFile({
        listingId: a.listingId,
        name: `${name} — certificate of completion.pdf`,
        mime: cert.mime,
        bytes: cert.bytes,
        uploaderId: "docusign",
        uploaderName: "DocuSign",
        source: "docusign",
        envelopeId: a.envelopeId,
        isCertificate: true,
      });
      already.add(`${a.envelopeId}:cert`);
      certificate = true;
    }
  }

  return { filed: true, certificate };
}
