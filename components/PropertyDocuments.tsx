"use client";

import { useEffect, useState } from "react";
import DoodleIcon from "@/components/DoodleIcon";
import { rexListingUrl } from "@/lib/rex-links";
import DocumentSheet, { type SheetDoc } from "@/components/DocumentSheet";

// Everything on file for a property, from both sides — and all of it opens
// here now.
//
// The REX half used to be a list you couldn't act on, because the Documents
// service exposes only `search`: no download method and no file endpoint. The
// way through turned out to be the `uri` REX returns on each row. Comparing a
// compliance entry's `file.uri` against its `file.url` (it carries both) gave
// the mapping, so a rexlive:// uri resolves to a real fetchable file — see
// rexUriToUrl. The bytes still come through our own proxy route, never REX's
// URL directly.

const IMAGE_RE = /\.(png|jpe?g|gif|webp|heic)$/i;

interface RexDoc {
  id: string;
  name: string;
  type: string | null;
  sizeMb: number | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
}
interface PortalFile {
  id: string;
  name: string;
  size: number;
  uploaderName: string;
  createdAt: string;
  source?: "upload" | "docusign";
  envelopeId?: string;
  isCertificate?: boolean;
}
interface Agreement {
  envelopeId: string;
  status: string;
  subject: string;
  sentAt: string | null;
  completedAt: string | null;
  signers: Array<{ name: string; email: string }>;
}

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

/** REX's status ids, in plain English. Anything new REX invents shows as-is
 *  rather than being flattened into a wrong-but-tidy label. */
const STATUS_LABEL: Record<string, string> = {
  completed: "Signed",
  partially_signed: "Partly signed",
  sent: "Awaiting signature",
  failed: "Failed",
};

/** The subject line is an email subject, not a document name — strip the
 *  DocuSign boilerplate so the drawer reads like a filing cabinet. */
const agreementTitle = (subject: string) =>
  subject
    .replace(/^(please|complete with)\s+docusign:?\s*/i, "")
    .replace(/^requesting your signature for\s*/i, "")
    .replace(/\.(pdf|docx?)$/i, "")
    .trim() || "Agreement";

export default function PropertyDocuments({
  listingId,
  lens = "rental",
}: {
  listingId: string;
  /** Which REX lens the deep link should open. */
  lens?: "rental" | "leased" | "sale";
}) {
  const [rex, setRex] = useState<RexDoc[] | null>(null);
  const [sheet, setSheet] = useState<SheetDoc | null>(null);
  const [portal, setPortal] = useState<PortalFile[]>([]);
  const [agreements, setAgreements] = useState<Agreement[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/my/property-documents?listingId=${encodeURIComponent(listingId)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d: { rex?: RexDoc[]; portal?: PortalFile[]; agreements?: Agreement[] | null }) => {
        if (cancelled) return;
        setRex(d.rex ?? []);
        setPortal(d.portal ?? []);
        setAgreements(d.agreements ?? null);
      })
      .catch(() => !cancelled && setRex([]));
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  const rexUrl = rexListingUrl(listingId, lens);

  // A DocuSign-filed PDF belongs under Agreements, not under "uploaded in the
  // portal" — nobody uploaded it.
  const uploaded = portal.filter((f) => f.source !== "docusign");
  const signedPdf = new Map(
    portal
      .filter((f) => f.source === "docusign" && f.envelopeId && !f.isCertificate)
      .map((f) => [f.envelopeId as string, f])
  );

  return (
    <div className="space-y-4">
      {/* ---- agreements: the DocuSign register, signed or not ---- */}
      {agreements && agreements.length ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Agreements
          </p>
          <div className="mt-2 space-y-1.5">
            {agreements.map((a) => {
              const pdf = signedPdf.get(a.envelopeId);
              const title = agreementTitle(a.subject);
              const meta = [
                STATUS_LABEL[a.status] ?? a.status,
                fmtDate(a.completedAt ?? a.sentAt),
                a.signers.map((s) => s.name).filter(Boolean).join(", ") || null,
              ]
                .filter(Boolean)
                .join(" · ");
              const body = (
                <>
                  <DoodleIcon
                    name="doc"
                    size={15}
                    className={`shrink-0 ${a.status === "completed" ? "text-accent" : "text-muted"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{title}</span>
                    <span className="block truncate text-[11px] text-muted">{meta}</span>
                  </span>
                  {/* Only claim it opens when there is actually a file behind it. */}
                  <span className="shrink-0 text-[11px] font-medium text-muted">
                    {pdf ? "Open" : ""}
                  </span>
                </>
              );
              return pdf ? (
                <a
                  key={a.envelopeId}
                  href={`/api/my/property-files/${pdf.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 transition hover:border-black/30"
                >
                  {body}
                </a>
              ) : (
                <div
                  key={a.envelopeId}
                  className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2.5"
                >
                  {body}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ---- uploaded here: ours to open ---- */}
      {uploaded.length ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Uploaded in the portal
          </p>
          <div className="mt-2 space-y-1.5">
            {uploaded.map((f) => (
              <a
                key={f.id}
                href={`/api/my/property-files/${f.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 transition hover:border-black/30"
              >
                <DoodleIcon name="doc" size={15} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{f.name}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {Math.max(1, Math.round(f.size / 1024))} KB · {f.uploaderName}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-medium text-muted">Open</span>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {/* ---- on the REX record: listed, opened over there ---- */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          On the REX record
        </p>
        {rex === null ? (
          <p className="mt-2 text-[12.5px] text-muted">Checking REX…</p>
        ) : rex.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-muted">
            No documents on the REX record for this property.
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {rex.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() =>
                  setSheet({
                    src: `/api/compliance/document?doc=${encodeURIComponent(d.id)}`,
                    title: d.name,
                    subtitle: [fmtDate(d.uploadedAt), d.uploadedBy].filter(Boolean).join(" · ") || null,
                    kind: IMAGE_RE.test(d.name) ? "image" : "file",
                  })
                }
                className="flex w-full items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 text-left transition hover:border-black/30"
              >
                <DoodleIcon name="doc" size={15} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{d.name}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {[
                      d.sizeMb ? `${d.sizeMb.toFixed(1)} MB` : null,
                      fmtDate(d.uploadedAt),
                      d.uploadedBy,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-medium text-muted">Open</span>
              </button>
            ))}
          </div>
        )}
        {rex && rex.length > 0 ? (
          <p className="mt-2 text-[11px] text-muted">
            Held on the REX record.{" "}
            <a href={rexUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              Open the record
            </a>{" "}
            to add or change them.
          </p>
        ) : null}
      </div>

      <DocumentSheet doc={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}
