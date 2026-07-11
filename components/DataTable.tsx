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
}: {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  compact?: boolean;
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
                className={`sticky top-0 z-10 border-b border-line bg-card ${cellPad} text-[11px] font-semibold uppercase tracking-wide text-muted ${
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
                className="border-b border-line/60 last:border-b-0 hover:bg-gray-50/60"
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
