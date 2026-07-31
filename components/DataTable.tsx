import type { ReactNode } from "react";

// Generic data table: sticky header, zebra-free, right-aligned numerics,
// compact 13px figures with tabular numerals. Wide tables scroll inside the
// card — the page never scrolls horizontally.

export interface DataTableColumn<Row extends Record<string, unknown> = Record<string, unknown>> {
  key: string;
  label: string;
  align?: "right" | "left";
  // eslint-disable-next-line no-unused-vars
  render?: (row: Row) => ReactNode;
}

function defaultCell(value: unknown): ReactNode {
  if (value == null || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString("en-GB");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export default function DataTable<
  Row extends Record<string, unknown> = Record<string, unknown>
>({
  columns,
  rows,
  compact = false,
  onRowClick,
}: {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  compact?: boolean;
  /** Optional — makes rows clickable (e.g. admin agent drill-down). */
  // eslint-disable-next-line no-unused-vars
  onRowClick?: (row: Row) => void;
}) {
  const cellPad = compact ? "px-3 py-1.5" : "px-3.5 py-2.5";

  return (
    <div className="card overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                // Header sits on the eggshell page colour with a heavier rule
                // under it — on outline cards a white header melted into the
                // first row and the table had no visible start.
                className={`sticky top-0 z-10 border-b-2 border-line bg-page ${cellPad} text-[11px] font-semibold uppercase tracking-wide text-muted ${
                  col.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className={`${cellPad} py-6 text-center text-muted`}
              >
                No rows yet.
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                // Only a clickable row gets a keyboard path — a plain row must
                // not become a tab stop with nothing to activate.
                role={onRowClick ? "button" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        onRowClick(row);
                      }
                    : undefined
                }
                className={`border-b border-line/60 last:border-b-0 hover:bg-gray-50/60 ${
                  onRowClick ? "cursor-pointer" : ""
                }`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`${cellPad} tnum ${
                      col.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {col.render ? col.render(row) : defaultCell(row[col.key])}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
