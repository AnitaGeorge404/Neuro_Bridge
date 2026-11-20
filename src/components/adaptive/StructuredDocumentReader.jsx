import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import TableRenderer from "@/components/adaptive/TableRenderer";

const VISUAL_TYPES = new Set([
  "image", "illustration", "diagram", "flowchart", "chart", "graph",
  "math_figure", "screenshot", "visual",
]);

function latexToReadable(text) {
  return String(text || "")
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, "square root of ($1)")
    .replace(/\\(?:times|cdot)/g, " × ")
    .replace(/\\(?:le|ge|neq|pm|infty)/g, (match) => ({
      "\\le": " ≤ ",
      "\\ge": " ≥ ",
      "\\neq": " ≠ ",
      "\\pm": " ± ",
      "\\infty": "∞",
    })[match] || match)
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .trim();
}

export function DocumentTitle({ block, children, readingFont }) {
  return (
    <h1 className="mb-5 text-3xl font-bold leading-tight text-slate-950" style={{ fontFamily: readingFont }}>
      {children || block?.text}
    </h1>
  );
}

export function DocumentHeading({ block, level = 2, children, readingFont }) {
  const HeadingTag = `h${Math.min(6, Math.max(2, level))}`;
  const size = level === 2 ? "text-2xl" : level === 3 ? "text-xl" : "text-lg";
  return (
    <HeadingTag
      className={cn("mb-3 mt-6 font-bold leading-tight text-slate-900", size)}
      aria-level={level}
      style={{ fontFamily: readingFont }}
    >
      {children || block?.text}
    </HeadingTag>
  );
}

export function DocumentParagraph({ children, className, readingFont }) {
  return (
    <p className={cn("mb-5 leading-relaxed", className)} style={{ fontFamily: readingFont }}>
      {children}
    </p>
  );
}

export function DocumentQuestion({ block, nested = false, children, readingFont }) {
  const Tag = nested ? "div" : "article";
  return (
    <Tag
      className={cn(
        "mb-5 rounded-xl border-l-4 border-amber-400 bg-amber-50/40 py-2 pr-3",
        nested ? "ml-6 pl-4" : "pl-4",
      )}
      aria-label={nested ? "Subquestion" : "Question"}
      style={{ fontFamily: readingFont }}
    >
      {children || block?.text}
    </Tag>
  );
}

export function DocumentList({ block, readingFont }) {
  const ListTag = block?.ordered ? "ol" : "ul";
  return (
    <ListTag
      className={cn(
        "mb-6 space-y-2",
        block?.ordered ? "list-decimal pl-7" : "list-disc pl-7",
      )}
      style={{ fontFamily: readingFont }}
    >
      {(block?.items || []).map((item, index) => (
        <li
          key={`${item.text}-${index}`}
          className="pl-1 leading-relaxed"
          style={{ marginLeft: `${Math.min(item.indent || 0, 4) * 1.25}rem` }}
        >
          {item.text?.replace(/^(?:[-*•▪◦]|\d+[.)])\s*/, "")}
        </li>
      ))}
    </ListTag>
  );
}

export function DocumentEquation({ block, readingFont }) {
  const original = block?.text || "";
  return (
    <div
      className="my-5 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
      role="math"
      aria-label={`Mathematical expression: ${original}`}
      style={{ fontFamily: `${readingFont || "inherit"}, "Cambria Math", "Noto Sans Symbols", "Segoe UI Symbol", serif` }}
    >
      <div className="min-w-max text-center text-lg leading-relaxed whitespace-pre-wrap">
        {original.includes("\\") ? latexToReadable(original) : original}
      </div>
      {original.includes("\\") && (
        <span className="sr-only">{original}</span>
      )}
    </div>
  );
}

export function DocumentTable(props) {
  return <TableRenderer {...props} />;
}

export function DocumentVisual({ block, readingFont }) {
  return (
    <motion.figure
      layout
      className="my-6 rounded-xl border border-slate-200/70 bg-white/60 p-3"
      style={{ fontFamily: readingFont }}
    >
      {block?.assetUrl ? (
        <img
          src={block.assetUrl}
          alt={block.caption || block.text || `${block.type.replace("_", " ")} from the document`}
          className="mx-auto h-auto max-h-[520px] max-w-full object-contain"
          loading="lazy"
        />
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          <span className="block font-semibold">{block?.type.replace("_", " ")}</span>
          {block?.text || "Visual identified, but the original asset could not be preserved."}
        </div>
      )}
      {block?.caption && (
        <figcaption className="mt-3 text-center text-sm leading-relaxed text-slate-600">
          {block.caption}
        </figcaption>
      )}
      {block?.relationshipIds?.length > 0 && (
        <span className="sr-only">
          Related content block identifiers: {block.relationshipIds.join(", ")}
        </span>
      )}
    </motion.figure>
  );
}

export default function StructuredDocumentReader({
  pages = [],
  fallbackBlocks = [],
  renderTextBlock,
  blockIndexFor,
  readingPreferences = {},
}) {
  const renderedPages = pages.length
    ? pages
    : [{ pageNumber: 1, blocks: fallbackBlocks }];
  const readingFont = readingPreferences.fontFamily || "inherit";
  const readerStyle = {
    fontFamily: readingFont,
    fontSize: readingPreferences.fontSize ? `${readingPreferences.fontSize}px` : undefined,
    lineHeight: readingPreferences.lineHeight,
    letterSpacing: readingPreferences.letterSpacing != null ? `${readingPreferences.letterSpacing}em` : undefined,
    wordSpacing: readingPreferences.wordSpacing != null ? `${readingPreferences.wordSpacing}em` : undefined,
  };

  return (
    <div className="space-y-8" style={readerStyle}>
      {renderedPages.map((page, pageIndex) => (
        <section
          key={`page-${page.pageNumber || pageIndex + 1}`}
          className="border-b border-slate-200 pb-8 last:border-b-0"
          aria-label={`Page ${page.pageNumber || pageIndex + 1}`}
        >
          <div
            className="mb-5 flex items-center justify-between border-b border-slate-200 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-500"
            aria-hidden="true"
          >
            <span>Page</span>
            <span>{page.pageNumber || pageIndex + 1}</span>
          </div>
          <div className="space-y-1">
            {(page.blocks || []).map((block, blockIndex) => {
              const key = block.id || `${page.pageNumber || pageIndex + 1}-${blockIndex}-${block.type}`;
              const parentIndex = blockIndexFor ? blockIndexFor(block) : blockIndex;

              if (block.type === "title") {
                return (
                  <DocumentTitle key={key} block={block} readingFont={readingFont}>
                    {renderTextBlock ? renderTextBlock(block, parentIndex) : block.text}
                  </DocumentTitle>
                );
              }
              if (block.type === "heading" || block.type === "subheading") {
                return (
                  <DocumentHeading
                    key={key}
                    block={block}
                    level={block.type === "subheading" ? (block.level || 3) : (block.level || 2)}
                    readingFont={readingFont}
                  >
                    {renderTextBlock ? renderTextBlock(block, parentIndex) : block.text}
                  </DocumentHeading>
                );
              }
              if (block.type === "question" || block.type === "subquestion") {
                return (
                  <DocumentQuestion key={key} block={block} nested={block.type === "subquestion"} readingFont={readingFont}>
                    {renderTextBlock ? renderTextBlock(block, parentIndex) : block.text}
                  </DocumentQuestion>
                );
              }
              if (block.type === "list" || block.type === "list_item") {
                return <DocumentList key={key} block={block.type === "list_item" ? { items: [block], ordered: false } : block} readingFont={readingFont} />;
              }
              if (block.type === "equation") {
                return <DocumentEquation key={key} block={block} readingFont={readingFont} />;
              }
              if (block.type === "table") {
                return (
                  <DocumentTable
                    key={key}
                    block={block}
                    readingFont={readingFont}
                    fontSize={readingPreferences.fontSize}
                    lineHeight={readingPreferences.lineHeight}
                    letterSpacing={readingPreferences.letterSpacing}
                    wordSpacing={readingPreferences.wordSpacing}
                    theme={readingPreferences.theme}
                  />
                );
              }
              if (VISUAL_TYPES.has(block.type)) {
                return <DocumentVisual key={key} block={block} readingFont={readingFont} />;
              }
              if (block.type === "instruction") {
                return (
                  <div key={key} className="mb-5 rounded-xl border-l-4 border-amber-400 bg-amber-50 px-4 py-3 italic" style={{ fontFamily: readingFont }}>
                    {renderTextBlock ? renderTextBlock(block, parentIndex) : block.text}
                  </div>
                );
              }
              if (block.type === "caption") {
                return (
                  <figcaption key={key} className="mb-5 text-center text-sm leading-relaxed text-slate-600" style={{ fontFamily: readingFont }}>
                    {renderTextBlock ? renderTextBlock(block, parentIndex) : block.text}
                  </figcaption>
                );
              }
              if (block.type === "header" || block.type === "footer" || block.type === "page_number") {
                return (
                  <div key={key} className="mb-3 text-center text-xs text-slate-500" style={{ fontFamily: readingFont }}>
                    {renderTextBlock ? renderTextBlock(block, parentIndex) : block.text}
                  </div>
                );
              }
              return (
                <DocumentParagraph key={key} readingFont={readingFont}>
                  {renderTextBlock ? renderTextBlock(block, parentIndex) : block.text}
                </DocumentParagraph>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
