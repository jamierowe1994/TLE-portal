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
}

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

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

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/my/property-documents?listingId=${encodeURIComponent(listingId)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d: { rex?: RexDoc[]; portal?: PortalFile[] }) => {
        if (cancelled) return;
        setRex(d.rex ?? []);
        setPortal(d.portal ?? []);
      })
      .catch(() => !cancelled && setRex([]));
    return () => {
      cancelled = true;
    };
  }, [listingId]);

  const rexUrl = rexListingUrl(listingId, lens);

  return (
    <div className="space-y-4">
      {/* ---- uploaded here: ours to open ---- */}
      {portal.length ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Uploaded in the portal
          </p>
          <div className="mt-2 space-y-1.5">
            {portal.map((f) => (
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
