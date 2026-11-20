import { describe, expect, it } from "vitest";
import { buildNativeTable, getStructuredDocument } from "../textExtractor";

describe("native table reconstruction", () => {
  it("detects three-column PDF text positions as one structured table", () => {
    const items = [
      { str: "Activity", transform: [1, 0, 0, 1, 50, 700], width: 50 },
      { str: "Points", transform: [1, 0, 0, 1, 220, 700], width: 40 },
      { str: "Category", transform: [1, 0, 0, 1, 390, 700], width: 55 },
      { str: "Reading", transform: [1, 0, 0, 1, 50, 660], width: 45 },
      { str: "10", transform: [1, 0, 0, 1, 220, 660], width: 15 },
      { str: "Learning", transform: [1, 0, 0, 1, 390, 660], width: 50 },
      { str: "Exercise", transform: [1, 0, 0, 1, 50, 620], width: 45 },
      { str: "15", transform: [1, 0, 0, 1, 220, 620], width: 15 },
      { str: "Movement", transform: [1, 0, 0, 1, 390, 620], width: 55 },
      { str: "Meditation", transform: [1, 0, 0, 1, 50, 580], width: 65 },
      { str: "20", transform: [1, 0, 0, 1, 220, 580], width: 15 },
      { str: "Wellbeing", transform: [1, 0, 0, 1, 390, 580], width: 55 },
      { str: "Creative activity", transform: [1, 0, 0, 1, 50, 540], width: 90 },
      { str: "15", transform: [1, 0, 0, 1, 220, 540], width: 15 },
      { str: "Creativity", transform: [1, 0, 0, 1, 390, 540], width: 55 },
    ];

    const table = buildNativeTable(items, 612, 792);
    expect(table).not.toBeNull();
    expect(table.headerRowCount).toBe(1);
    expect(table.rows).toEqual([
      ["Activity", "Points", "Category"],
      ["Reading", "10", "Learning"],
      ["Exercise", "15", "Movement"],
      ["Meditation", "20", "Wellbeing"],
      ["Creative activity", "15", "Creativity"],
    ]);
  });

  it("preserves headerRowCount through stored structured OCR records", () => {
    const document = getStructuredDocument({
      ocr_structure: {
        version: 1,
        pages: [{
          pageNumber: 1,
          blocks: [{
            type: "table",
            rows: [
              ["Activity", "Points", "Category"],
              ["Reading", "10", "Learning"],
            ],
            headerRowCount: 1,
          }],
        }],
      },
    });

    expect(document.pages[0].blocks[0].headerRowCount).toBe(1);
    expect(document.pages[0].blocks[0].headerRows).toEqual([0]);
  });
});
