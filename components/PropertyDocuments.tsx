"use client";

import { useEffect, useState } from "react";
import DoodleIcon from "@/components/DoodleIcon";
import { rexListingUrl } from "@/lib/rex-links";

// Everything on file for a property, from both sides.
//
// Files uploaded through the portal are ours, so they open and download here.
// Documents living on the REX record can only be listed: REX's API exposes a
// search on Documents and nothing else — no download method, no file endpoint
// — so those rows link back to the REX record instead of pretending.

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
              <a
                key={d.id}
                href={rexUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 transition hover:border-black/30"
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
                <span className="shrink-0 text-[11px] font-medium text-muted">Open in REX</span>
              </a>
            ))}
          </div>
        )}
        {rex && rex.length > 0 ? (
          <p className="mt-2 text-[11px] text-muted">
            REX doesn&rsquo;t let us fetch these files directly, so they open on the
            record itself.
          </p>
        ) : null}
      </div>
    </div>
  );
}
