import React from "react";
import { cn } from "@/lib/utils";

function normalizeRows(rows = []) {
  return rows.map((row) =>
    (Array.isArray(row) ? row : [row]).map((cell) =>
      typeof cell === "object" && cell !== null
        ? {
            text: cell.text ?? cell.value ?? "",
            colSpan: Number(cell.colSpan || cell.colspan || 1),
            rowSpan: Number(cell.rowSpan || cell.rowspan || 1),
          }
        : { text: String(cell ?? ""), colSpan: 1, rowSpan: 1 },
    ),
  );
}

export default function TableRenderer({
  block,
  readingFont,
  fontSize,
  lineHeight,
  letterSpacing,
  wordSpacing,
  theme,
}) {
  const rows = normalizeRows(block?.rows);
  if (!rows.length) {
    return (
      <div role="note" className="my-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p className="font-semibold">Table content could not be reconstructed reliably.</p>
        {block?.text && <p className="mt-2 whitespace-pre-wrap">{block.text}</p>}
      </div>
    );
  }

  const headerRows = Array.isArray(block?.headerRows)
    ? block.headerRows.map(Number).filter((row) => Number.isInteger(row))
    : Number.isInteger(Number(block?.headerRowCount))
      ? Array.from({ length: Math.max(0, Number(block.headerRowCount)) }, (_, index) => index)
    : block?.headerRow != null
      ? [Number(block.headerRow)]
      : [0];
  const headerRowSet = new Set(headerRows);
  const columnAlignments = Array.isArray(block?.columnAlignments)
    ? block.columnAlignments
    : Array.isArray(block?.alignments)
      ? block.alignments
      : [];

  const tableStyle = {
    fontFamily: readingFont,
    fontSize: `${fontSize || 24}px`,
    lineHeight: lineHeight || 1.85,
    letterSpacing: `${letterSpacing || 0.02}em`,
    wordSpacing: `${wordSpacing || 0.1}em`,
    color: theme?.color,
  };

  return (
    <div
      className="my-6 max-w-full overflow-x-auto rounded-xl border border-slate-300 bg-white/70"
      role="region"
      aria-label="Document table"
      tabIndex={0}
      style={{
        color: theme?.color,
        backgroundColor: theme?.backgroundColor || "#ffffff",
      }}
    >
      <table
        className="min-w-full border-collapse"
        style={tableStyle}
        aria-describedby={block?.caption ? `table-caption-${block.id || "document"}` : undefined}
      >
        {block?.caption && (
          <caption
            id={`table-caption-${block.id || "document"}`}
            className="p-3 text-left font-semibold"
          >
            {block.caption}
          </caption>
        )}
        {headerRows.length > 0 && (
          <thead>
            {rows.map((row, rowIndex) => headerRowSet.has(rowIndex) ? (
              <tr
                key={`header-${rowIndex}`}
                style={{ backgroundColor: theme?.backgroundColor ? "color-mix(in srgb, currentColor 8%, transparent)" : "#f1f5f9" }}
              >
                {row.map((cell, columnIndex) => (
                  <th
                    key={`header-${rowIndex}-${columnIndex}`}
                    scope="col"
                    colSpan={cell.colSpan}
                    rowSpan={cell.rowSpan}
                    className="border border-slate-300 px-3 py-2 text-left font-bold"
                    style={{ textAlign: columnAlignments[columnIndex] || "left" }}
                  >
                    {cell.text}
                  </th>
                ))}
              </tr>
            ) : null)}
          </thead>
        )}
        <tbody>
          {rows.map((row, rowIndex) => headerRowSet.has(rowIndex) ? null : (
            <tr
              key={`row-${rowIndex}`}
              className={rowIndex % 2 === 0 ? "bg-white" : "bg-slate-50"}
            >
              {row.map((cell, columnIndex) => (
                <td
                  key={`cell-${rowIndex}-${columnIndex}`}
                  colSpan={cell.colSpan}
                  rowSpan={cell.rowSpan}
                  className={cn("border border-slate-300 px-3 py-2 align-top")}
                  style={{ textAlign: columnAlignments[columnIndex] || "left" }}
                  aria-label={
                    headerRows.length && rows[headerRows[0]]?.[columnIndex]?.text
                      ? `${rows[headerRows[0]][columnIndex].text}: ${cell.text}`
                      : undefined
                  }
                >
                  {cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
