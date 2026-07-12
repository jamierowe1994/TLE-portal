"use client";

import React, { useEffect, useMemo, useState } from "react";

// A drag-to-arrange dashboard grid. Each block is a titled row/section that
// Susan can drag by its title, resize (S/M/L width), and switch between views
// (cards / bar / pie / line …). Layout persists per browser (localStorage).
// In presentation mode the edit chrome hides but her saved layout still applies.

export type ViewType = "cards" | "bar" | "pie" | "line" | "funnel";

export interface DashBlock {
  id: string;
  title: string;
  source?: string;
  defaultSpan: 1 | 2 | 3 | 4;
  views: readonly ViewType[]; // first = default
  render: (view: ViewType) => React.ReactNode;
}

interface BlockLayout {
  id: string;
  span: number;
  view: ViewType;
}

const SPAN_LG: Record<number, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
};
const SPAN_MD: Record<number, string> = {
  1: "md:col-span-1",
  2: "md:col-span-2",
  3: "md:col-span-2",
  4: "md:col-span-2",
};

const VIEW_LABEL: Record<ViewType, string> = {
  cards: "Cards",
  bar: "Bar",
  pie: "Pie",
  line: "Line",
  funnel: "Funnel",
};

// Width steps: half / three-quarter / full of the 4-column grid. Span 1
// (quarter width) is intentionally omitted — it crushes multi-stat blocks into
// unreadable slivers. "Small" here means half-width, a proper box.
const SIZE_ORDER = [2, 3, 4] as const;
const SIZE_LABEL: Record<number, string> = { 2: "S", 3: "M", 4: "L" };
const clampSpan = (n: number) => (n >= 4 ? 4 : n >= 3 ? 3 : 2);

function defaultsFor(blocks: DashBlock[]): BlockLayout[] {
  return blocks.map((b) => ({ id: b.id, span: clampSpan(b.defaultSpan), view: b.views[0] }));
}

/** Merge a saved layout with the current blocks: keep saved order/size/view for
 * known ids, append any new blocks, drop ids that no longer exist. */
function reconcile(saved: BlockLayout[], blocks: DashBlock[]): BlockLayout[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const out: BlockLayout[] = [];
  const seen = new Set<string>();
  for (const s of saved) {
    const b = byId.get(s.id);
    if (!b) continue;
    const view = b.views.includes(s.view) ? s.view : b.views[0];
    out.push({ id: s.id, span: clampSpan(s.span || b.defaultSpan), view });
    seen.add(s.id);
  }
  for (const b of blocks) if (!seen.has(b.id)) out.push({ id: b.id, span: clampSpan(b.defaultSpan), view: b.views[0] });
  return out;
}

export default function CustomizableGrid({
  blocks,
  storageKey,
}: {
  blocks: DashBlock[];
  storageKey: string;
}) {
  const blockById = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);
  const [layout, setLayout] = useState<BlockLayout[]>(() => defaultsFor(blocks));
  const [editing, setEditing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  // Apply the saved layout once the blocks exist (blocks start empty while the
  // data loads, so this must wait for them — and re-run if the set changes).
  // Client-only read, so no SSR hydration mismatch.
  useEffect(() => {
    if (blocks.length === 0) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      const saved = raw ? (JSON.parse(raw) as BlockLayout[]) : null;
      setLayout(saved ? reconcile(saved, blocks) : defaultsFor(blocks));
    } catch {
      setLayout(defaultsFor(blocks));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, storageKey]);

  function persist(next: BlockLayout[]) {
    setLayout(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* storage full / disabled — layout still works this session */
    }
  }

  function setSpan(id: string, span: number) {
    persist(layout.map((l) => (l.id === id ? { ...l, span } : l)));
  }
  function setView(id: string, view: ViewType) {
    persist(layout.map((l) => (l.id === id ? { ...l, view } : l)));
  }
  function reset() {
    persist(defaultsFor(blocks));
  }

  // Move dragId to sit before targetId.
  function reorder(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = layout.findIndex((l) => l.id === dragId);
    const to = layout.findIndex((l) => l.id === targetId);
    if (from < 0 || to < 0) return;
    const next = layout.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setLayout(next); // commit to storage on drop
  }

  return (
    <div>
      {/* toolbar */}
      <div className="hide-when-presenting mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className={`btn-press inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition ${
            editing ? "border-accent bg-accent text-white" : "hairline border-line bg-card text-ink"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 5h10M3 8h10M3 11h6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          {editing ? "Done" : "Customise"}
        </button>
        {editing ? (
          <>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium text-muted hover:text-ink"
            >
              Reset layout
            </button>
            <span className="text-[12px] text-muted">
              Drag a block by its title to move it · use the controls to resize or switch view
            </span>
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {layout.map((l) => {
          const block = blockById.get(l.id);
          if (!block) return null;
          return (
            <section
              key={l.id}
              className={`${SPAN_MD[l.span]} ${SPAN_LG[l.span]} ${
                editing ? "rounded-2xl ring-1 ring-line" : ""
              } ${dragId === l.id ? "opacity-50" : ""}`}
              draggable={editing}
              onDragStart={() => setDragId(l.id)}
              onDragOver={(e) => {
                if (editing && dragId) {
                  e.preventDefault();
                  reorder(l.id);
                }
              }}
              onDrop={() => {
                if (dragId) persist(layout);
                setDragId(null);
              }}
              onDragEnd={() => {
                if (dragId) persist(layout);
                setDragId(null);
              }}
            >
              {/* edit controls */}
              {editing ? (
                <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-page px-2 py-1.5">
                  <span className="flex cursor-grab items-center gap-1 text-[12px] font-semibold text-ink active:cursor-grabbing">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <circle cx="5" cy="4" r="1.3" /><circle cx="11" cy="4" r="1.3" />
                      <circle cx="5" cy="8" r="1.3" /><circle cx="11" cy="8" r="1.3" />
                      <circle cx="5" cy="12" r="1.3" /><circle cx="11" cy="12" r="1.3" />
                    </svg>
                    {block.title}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    {/* size */}
                    <div className="flex overflow-hidden rounded-md border border-line">
                      {SIZE_ORDER.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSpan(l.id, s)}
                          className={`px-1.5 py-0.5 text-[10px] font-semibold ${
                            l.span === s ? "bg-accent text-white" : "bg-card text-muted hover:text-ink"
                          }`}
                          title={`Width: ${SIZE_LABEL[s]}`}
                        >
                          {SIZE_LABEL[s]}
                        </button>
                      ))}
                    </div>
                    {/* view */}
                    {block.views.length > 1 ? (
                      <div className="flex overflow-hidden rounded-md border border-line">
                        {block.views.map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setView(l.id, v)}
                            className={`px-1.5 py-0.5 text-[10px] font-semibold ${
                              l.view === v ? "bg-ink text-white" : "bg-card text-muted hover:text-ink"
                            }`}
                          >
                            {VIEW_LABEL[v]}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {block.render(l.view)}
            </section>
          );
        })}
      </div>
    </div>
  );
}
