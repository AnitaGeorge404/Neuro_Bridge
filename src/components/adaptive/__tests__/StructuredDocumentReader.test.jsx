import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StructuredDocumentReader from "../StructuredDocumentReader";

describe("StructuredDocumentReader", () => {
  it("renders document titles, headings, questions, lists and equations as distinct elements", () => {
    const { container } = render(
      <StructuredDocumentReader
        readingPreferences={{ fontFamily: '"OpenDyslexic", sans-serif', fontSize: 22 }}
        pages={[{
          pageNumber: 1,
          blocks: [
            { id: "title", type: "title", text: "Mathematics Paper" },
            { id: "heading", type: "heading", text: "Section A", level: 2 },
            { id: "question", type: "question", text: "1. Solve 2 + 2." },
            { id: "equation", type: "equation", text: "x^2 + y^2 = z^2" },
            { id: "list", type: "list", ordered: true, items: [{ text: "First" }, { text: "Second" }] },
          ],
        }]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Mathematics Paper" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Section A" })).toBeTruthy();
    expect(screen.getByLabelText("Question")).toBeTruthy();
    expect(screen.getByRole("math")).toBeTruthy();
    expect(screen.getByText("First")).toBeTruthy();
    expect(container.firstElementChild.style.fontFamily).toBe('"OpenDyslexic", sans-serif');
  });

  it("renders table cells and preserved visual assets", () => {
    render(
      <StructuredDocumentReader
        pages={[{
          pageNumber: 2,
          blocks: [
            { type: "table", rows: [["Subject", "Score"], ["Math", "90"]] },
            { type: "diagram", assetUrl: "data:image/png;base64,test", caption: "Figure 1: Triangle" },
          ],
        }]}
      />,
    );

    expect(screen.getByRole("region", { name: "Document table" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Figure 1: Triangle" })).toBeTruthy();
    expect(screen.getByText("Page")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("renders a structured table with semantic headers and reading preferences", () => {
    const { container } = render(
      <StructuredDocumentReader
        readingPreferences={{
          fontFamily: '"OpenDyslexic", sans-serif',
          fontSize: 20,
          lineHeight: 1.9,
        }}
        pages={[{
          pageNumber: 1,
          blocks: [{
            id: "sample-data",
            type: "table",
            headerRows: [0],
            columnAlignments: ["left", "right"],
            rows: [
              ["Activity", "Value"],
              ["Walking", "20"],
              ["Reading", "30"],
              ["Drawing", "15"],
              ["Rest", "10"],
            ],
          }],
        }]}
      />,
    );

    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelectorAll("thead th")).toHaveLength(2);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(4);
    expect(screen.getByRole("columnheader", { name: "Activity" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "Value: 20" })).toBeTruthy();
  });

  it("shows a fallback instead of silently losing an unidentified visual", () => {
    render(
      <StructuredDocumentReader
        pages={[{
          pageNumber: 1,
          blocks: [{ type: "visual", text: "A flowchart could not be cropped." }],
        }]}
      />,
    );

    expect(screen.getByText("A flowchart could not be cropped.")).toBeTruthy();
  });
});
