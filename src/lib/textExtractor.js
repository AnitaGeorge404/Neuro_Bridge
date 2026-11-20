import mammoth from "mammoth";
import { callGeminiProxy, extractGeminiText } from "@/lib/geminiProxyClient";

export const STRUCTURED_DOCUMENT_VERSION = 1;
const BLOCK_TYPES = new Set([
  "title", "heading", "subheading", "instruction", "paragraph", "question",
  "subquestion", "list", "list_item", "equation", "table", "caption",
  "header", "footer", "page_number", "image", "illustration", "diagram",
  "flowchart", "chart", "graph", "math_figure", "screenshot", "visual",
]);

function makeBlock(type, text, extra = {}) {
  const cleanText = String(text || "").trim();
  if (!cleanText && type !== "table") return null;
  return {
    type: BLOCK_TYPES.has(type) ? type : "paragraph",
    text: cleanText,
    ...extra,
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildNativeTable(textItems, pageWidth, pageHeight) {
  if (!Array.isArray(textItems) || textItems.length < 8) return null;

  const positioned = textItems.map((item) => {
    const x = Number(item.transform?.[4]) || 0;
    const y = Number(item.transform?.[5]) || 0;
    const width = Number(item.width) || Number(item.str?.length || 0);
    return { text: String(item.str || "").trim(), x, y, width };
  }).filter((item) => item.text);

  if (!positioned.length) return null;

  const rowMap = new Map();
  positioned.forEach((item) => {
    const yKey = Math.round(item.y / 4) * 4;
    let row = rowMap.get(yKey);
    if (!row) {
      row = { y: yKey, items: [] };
      rowMap.set(yKey, row);
    }
    row.items.push(item);
  });

  const rows = [...rowMap.values()]
    .sort((a, b) => b.y - a.y)
    .map((row) => ({
      y: row.y,
      items: row.items.sort((a, b) => a.x - b.x),
    }));

  if (rows.length < 3) return null;

  const starts = positioned.map((item) => item.x);
  const columnClusters = [];
  starts.sort((a, b) => a - b).forEach((x) => {
    const tolerance = pageWidth * 0.018;
    const cluster = columnClusters.find((value) => Math.abs(value - x) <= tolerance);
    if (cluster == null) columnClusters.push(x);
    else columnClusters[columnClusters.indexOf(cluster)] = median([cluster, x]);
  });

  if (columnClusters.length < 2 || columnClusters.length > 12) return null;

  const bounds = [...columnClusters].sort((a, b) => a - b);
  const columnCount = bounds.length;
  if (columnCount < 2) return null;

  const tableRows = rows.map((row) => {
    const cells = Array.from({ length: columnCount }, () => "");
    row.items.forEach((item) => {
      let columnIndex = 0;
      let bestDistance = Infinity;
      bounds.forEach((bound, index) => {
        const distance = Math.abs(bound - item.x);
        if (distance < bestDistance) {
          bestDistance = distance;
          columnIndex = index;
        }
      });
      cells[columnIndex] = cells[columnIndex]
        ? `${cells[columnIndex]} ${item.text}`
        : item.text;
    });
    return cells;
  }).filter((row) => row.some((cell) => cell));

  const structuredRowCount = tableRows.filter((row) =>
    row.filter((cell) => cell).length >= 2,
  ).length;
  if (structuredRowCount < 3 || structuredRowCount / tableRows.length < 0.75) return null;

  const nonEmptyColumns = [];
  tableRows.forEach((row) => row.forEach((cell, index) => {
    if (cell) nonEmptyColumns[index] = true;
  }));
  const activeColumnCount = nonEmptyColumns.filter(Boolean).length;
  if (tableRows.length < 3 || activeColumnCount < 2) return null;

  const widthTolerance = pageWidth * 0.7;
  const xValues = positioned.map((item) => item.x);
  const tableWidth = Math.max(...positioned.map((item) => item.x + item.width)) - Math.min(...xValues);
  if (tableWidth < widthTolerance * 0.25) return null;

  const firstY = rows[0].y;
  const lastY = rows[rows.length - 1].y;
  const minX = Math.min(...xValues);
  const maxX = Math.max(...positioned.map((item) => item.x + item.width));
  const normalizedRows = tableRows.map((row) => row.filter((_, index) => nonEmptyColumns[index]));

  if (normalizedRows[0]?.length < 2) return null;

  return {
    rows: normalizedRows,
    headerRows: [0],
    headerRowCount: 1,
    columnAlignments: normalizedRows[0].map(() => "left"),
    yRange: [lastY, firstY],
    xRange: [minX, maxX],
    bbox: {
      x: Math.max(0, minX / pageWidth),
      y: Math.max(0, 1 - (firstY / pageHeight)),
      width: Math.min(1, (maxX - minX) / pageWidth),
      height: Math.min(1, Math.abs(firstY - lastY) / pageHeight),
    },
  };
}

function classifyLine(line, previousType = "") {
  const value = line.trim();
  if (!value) return null;
  if (/^(page\s*)?\d+\s*(of\s*\d+)?$/i.test(value)) return makeBlock("page_number", value);
  if (/^(?:instructions?|directions?|note|notes|important)\s*:/i.test(value)) {
    return makeBlock("instruction", value);
  }
  if (/^(?:\(?\d{1,3}[.)]|\(?[a-z][.)])\s+/.test(value)) {
    const isSubquestion = /^\(?[a-z][.)]\s+/i.test(value) || /^\(?\d+\.\d+/.test(value);
    return makeBlock(isSubquestion ? "subquestion" : "question", value);
  }
  if (/^(?:[-*•▪◦]|\d+[.)])\s+/.test(value)) return makeBlock("list_item", value);
  if (
    /[=<>≤≥≠≈∫√∑π∆∆²³⁰-⁹₀-₉]|\\(?:frac|sqrt|sum|int|times|cdot)|\b\d+\s*\/\s*\d+\b/.test(value)
    && value.length <= 500
  ) {
    return makeBlock("equation", value);
  }
  if (value.length <= 120 && !/[.!?]$/.test(value) && (previousType === "" || previousType === "paragraph")) {
    return makeBlock(previousType === "" ? "title" : "heading", value, { level: previousType === "" ? 1 : 2 });
  }
  return makeBlock("paragraph", value);
}

export function createStructuredDocumentFromText(text, pageTexts = []) {
  const pages = pageTexts.length
    ? pageTexts
    : String(text || "").split(/\f|\n\s*\n(?=\s*Page\s+\d+)/i);
  const structuredPages = pages.map((pageText, pageIndex) => {
    const lines = String(pageText || "").split(/\r?\n/);
    const blocks = [];
    let previousType = "";
    let listItems = [];
    const flushList = () => {
      if (listItems.length) {
        blocks.push(makeBlock("list", listItems.map((item) => item.text).join("\n"), {
          items: listItems.map((item) => ({ text: item.text, marker: item.text.match(/^(?:[-*•▪◦]|\d+[.)])/)?.[0] || null })),
          ordered: /^\s*\d+[.)]/.test(listItems[0].text),
        }));
        listItems = [];
      }
    };
    lines.forEach((line) => {
      const block = classifyLine(line, previousType);
      if (!block) return;
      if (block.type === "list_item") {
        listItems.push(block);
        return;
      }
      flushList();
      if (block.type === "equation" && blocks[blocks.length - 1]?.type === "equation") {
        const previous = blocks[blocks.length - 1];
        previous.text = `${previous.text}\n${block.text}`.trim();
        previousType = "equation";
        return;
      }
      blocks.push(block);
      previousType = block.type;
    });
    flushList();
    return { pageNumber: pageIndex + 1, blocks: blocks.filter(Boolean) };
  });
  const normalizedPages = structuredPages.filter((page) => page.blocks.length > 0);
  const allBlocks = normalizedPages.flatMap((page) => page.blocks);
  return {
    version: STRUCTURED_DOCUMENT_VERSION,
    pages: normalizedPages.length ? normalizedPages : [{ pageNumber: 1, blocks: [] }],
    blocks: allBlocks,
  };
}

function normalizeStructuredDocument(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const rawPages = Array.isArray(candidate.pages) ? candidate.pages : [];
  const pages = rawPages.map((page, pageIndex) => ({
    pageNumber: Number(page?.pageNumber) || pageIndex + 1,
    pageSize: page?.pageSize && typeof page.pageSize === "object"
      ? { width: Number(page.pageSize.width) || 612, height: Number(page.pageSize.height) || 792 }
      : undefined,
    blocks: (Array.isArray(page?.blocks) ? page.blocks : []).map((block) => {
      const items = Array.isArray(block?.items)
        ? block.items.map((item) => typeof item === "string" ? { text: item } : item).filter((item) => item?.text)
        : undefined;
      const rows = Array.isArray(block?.rows)
        ? block.rows.filter((row) => Array.isArray(row))
        : undefined;
      const headerRows = Array.isArray(block?.headerRows)
        ? block.headerRows.map(Number).filter(Number.isInteger)
        : Number.isInteger(Number(block?.headerRowCount))
          ? Array.from({ length: Math.max(0, Number(block.headerRowCount)) }, (_, index) => index)
          : Number.isInteger(Number(block?.headerRow))
            ? [Number(block.headerRow)]
            : undefined;
      const columnAlignments = Array.isArray(block?.columnAlignments)
        ? block.columnAlignments
        : Array.isArray(block?.alignments)
          ? block.alignments
          : undefined;
      const bbox = block?.bbox && typeof block.bbox === "object"
        ? {
            x: Number(block.bbox.x) || 0,
            y: Number(block.bbox.y) || 0,
            width: Number(block.bbox.width) || 0,
            height: Number(block.bbox.height) || 0,
          }
        : undefined;
      const blockText = block?.text ||
        (items ? items.map((item) => item.text).join("\n") : "") ||
        (rows ? rows.map((row) => row.join(" | ")).join("\n") : "");
      const normalized = makeBlock(block?.type, blockText, {
        ...(block?.id ? { id: String(block.id) } : {}),
        ...(block?.level ? { level: Number(block.level) } : {}),
        ...(items ? { items } : {}),
        ...(rows ? { rows } : {}),
        ...(headerRows ? { headerRows } : {}),
        ...(block?.headerRowCount != null ? { headerRowCount: Number(block.headerRowCount) } : {}),
        ...(block?.headerRow != null ? { headerRow: Number(block.headerRow) } : {}),
        ...(columnAlignments ? { columnAlignments } : {}),
        ...(block?.ordered != null ? { ordered: Boolean(block.ordered) } : {}),
        ...(bbox ? { bbox } : {}),
        ...(block?.alignment ? { alignment: block.alignment } : {}),
        ...(block?.readingOrder != null ? { readingOrder: Number(block.readingOrder) } : {}),
        ...(block?.relationshipIds ? { relationshipIds: block.relationshipIds } : {}),
        ...(block?.caption ? { caption: block.caption } : {}),
        ...(block?.assetUrl ? { assetUrl: block.assetUrl } : {}),
        ...(block?.assetType ? { assetType: block.assetType } : {}),
        ...(block?.extractionStatus ? { extractionStatus: block.extractionStatus } : {}),
      });
      return normalized;
    }).filter(Boolean),
  })).filter((page) => page.blocks.length);
  if (!pages.length) return null;
  return {
    version: STRUCTURED_DOCUMENT_VERSION,
    pages,
    blocks: pages.flatMap((page) => page.blocks),
  };
}

export function getStructuredDocument(record) {
  const stored = record?.ocr_structure || record?.metadata?.structured_content;
  return normalizeStructuredDocument(stored) ||
    (record?.ocr_text ? createStructuredDocumentFromText(record.ocr_text) : null);
}

export function structuredDocumentToText(document) {
  return (document?.pages || []).flatMap((page) =>
    (page.blocks || []).map((block) => {
      if (block.type === "table" && Array.isArray(block.rows)) {
        return block.rows.map((row) => row.map((cell) => cell ?? "").join(" | ")).join("\n");
      }
      if (block.type === "list" && Array.isArray(block.items)) return block.items.map((item) => item.text).join("\n");
      return block.text || "";
    }),
  ).filter(Boolean).join("\n\n").trim();
}

let pdfjsLibPromise = null;
async function getPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("pdfjs-dist").then((lib) => {
      if (typeof window !== "undefined" && lib) {
        lib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${lib.version || "4.0.379"}/pdf.worker.min.mjs`;
      }
      return lib;
    });
  }
  return pdfjsLibPromise;
}

/**
 * Convert File or Blob to Base64 string (data without prefix)
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = typeof result === "string" ? result.split(",")[1] : "";
      resolve(base64);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Perform structured Gemini Vision OCR while preserving document reading order.
 */
export async function extractTextFromImage(file, user) {
  const base64Data = await fileToBase64(file);
  const mimeType = file.type || "image/jpeg";

  const requestedModel = import.meta.env.VITE_OCR_GEMINI_MODEL || "gemini-2.5-flash";
  const models = [...new Set([requestedModel, "gemini-2.5-flash", "gemini-2.0-flash"])];
  let lastErrorMsg = "";

  for (const model of models) {
    try {
      const result = await callGeminiProxy({
        model,
        contents: [
          {
            parts: [
              {
                text: `You are a document reconstruction OCR engine. Read this page in natural reading order (top-to-bottom, left-to-right, respecting columns).
Return ONLY valid JSON with this shape:
{"version":1,"pages":[{"pageSize":{"width":612,"height":792},"pageNumber":1,"blocks":[{"id":"b1","type":"title|heading|subheading|instruction|paragraph|question|subquestion|list|equation|table|caption|header|footer|page_number|image|illustration|diagram|flowchart|chart|graph|math_figure|screenshot|visual","text":"verbatim text","level":1,"items":[{"text":"verbatim item","marker":"-","indent":0}],"rows":[[{"text":"Header","colSpan":1,"rowSpan":1},"cell"]],"headerRows":[0],"headerRowCount":1,"columnAlignments":["left","left"],"bbox":{"x":0.1,"y":0.2,"width":0.3,"height":0.2},"alignment":"left|center|right|inline","readingOrder":1,"relationshipIds":["b0"],"caption":"caption text","extractionStatus":"identified_by_vision"}]}]}
Rules:
- Preserve every legible character, punctuation, mathematical symbol, superscript/subscript notation and numbering verbatim; never solve or rewrite equations.
- Keep each paragraph, heading, instruction, question and subquestion as its own block. Use heading levels (1-6).
- Represent lists as one list block with ordered=true/false and items; preserve indentation in nested items with an indent number.
- Represent tables as rows of cells, preserving table boundaries, row/column relationships, headerRows, columnAlignments and colspan/rowspan. Use one table block; do not flatten tables into prose.
- Identify every meaningful image, illustration, diagram, flowchart, chart, graph, mathematical figure or screenshot. Give it a stable block id, normalized bbox from 0 to 1, alignment and readingOrder.
- Link visual blocks to nearby captions, labels, explanations and questions using relationshipIds and repeat the associated caption text in caption.
- Do not move a visual away from its surrounding content; place it at the same readingOrder as its position in the page.
- Include page numbers and meaningful headers/footers as their own blocks.
- Do not invent text. Use an empty string only when text is genuinely unreadable.`,
              },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
        user,
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      });

      if (!result.ok) {
        lastErrorMsg = result.error || "OCR request failed";
        if (/unreachable|network|failed to fetch/i.test(lastErrorMsg)) {
          throw new Error(lastErrorMsg);
        }
        if (lastErrorMsg.includes("no longer available") || lastErrorMsg.includes("not found")) {
          continue;
        }
        throw new Error(lastErrorMsg);
      }

      const extractedText = extractGeminiText(result.data).trim();
      let parsed;
      try {
        const jsonText = extractedText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
        parsed = normalizeStructuredDocument(JSON.parse(jsonText));
      } catch {
        parsed = null;
      }

      if (!parsed) {
        throw new Error("No readable text was detected in the provided image.");
      }

      return parsed;
    } catch (err) {
      if (err.message?.includes("No readable text")) throw err;
      if (/OCR service unreachable|not reachable/i.test(err.message || "")) throw err;
      lastErrorMsg = err.message;
    }
  }

  throw new Error(lastErrorMsg || "OCR Request failed across models.");
}

/**
 * Render a PDF page onto a canvas and return it as a Blob
 */
async function pdfPageToImageBlob(page) {
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({ canvasContext: context, viewport }).promise;

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85);
  });
}

async function cropPageVisuals(page, visualBlocks, pdfjsLib) {
  if (!visualBlocks?.length) return visualBlocks || [];
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({ canvasContext: context, viewport }).promise;

  return Promise.all(visualBlocks.map(async (block, index) => {
    const bbox = block.bbox;
    if (!bbox || typeof context.getImageData !== "function") {
      return { ...block, extractionStatus: "position_unknown", assetType: "page_fallback" };
    }
    const x = Math.max(0, Math.floor(bbox.x * canvas.width));
    const y = Math.max(0, Math.floor(bbox.y * canvas.height));
    const width = Math.min(canvas.width - x, Math.max(1, Math.ceil(bbox.width * canvas.width)));
    const height = Math.min(canvas.height - y, Math.max(1, Math.ceil(bbox.height * canvas.height)));
    const crop = document.createElement("canvas");
    crop.width = width;
    crop.height = height;
    crop.getContext("2d").drawImage(canvas, x, y, width, height, 0, 0, width, height);
    const assetUrl = crop.toDataURL("image/png");
    return {
      ...block,
      id: block.id || `visual-${index + 1}`,
      assetUrl,
      assetType: "image/png",
      extractionStatus: "preserved_crop",
    };
  }));
}

async function pdfPageHasVisualOperators(page, pdfjsLib) {
  const operatorList = await page.getOperatorList();
  const fnNames = new Set([
    "paintImageXObject",
    "paintImageMaskXObject",
    "paintInlineImageXObject",
    "paintImageXObjectRepeat",
  ]);
  return operatorList.fnArray.some((fn) =>
    fnNames.has(pdfjsLib.OPS?.[fn] ? Object.keys(pdfjsLib.OPS).find((name) => pdfjsLib.OPS[name] === fn) : ""),
  ) || operatorList.fnArray.some((fn) => {
    const name = Object.keys(pdfjsLib.OPS || {}).find((key) => pdfjsLib.OPS[key] === fn);
    return fnNames.has(name);
  });
}

/**
 * Extract text from document file (.pdf, .docx, .doc, .txt)
 */
export async function extractTextFromFile(file, onProgress, user) {
  const fileName = file.name.toLowerCase();

  // TXT files
  if (fileName.endsWith(".txt") || file.type === "text/plain") {
    onProgress?.({ stage: "extracting", message: "Reading text file..." });
    const text = await file.text();
    if (!text.trim()) {
      throw new Error("The selected text file is empty.");
    }
    return createStructuredDocumentFromText(text);
  }

  // DOCX / DOC files
  if (
    fileName.endsWith(".docx") ||
    fileName.endsWith(".doc") ||
    file.type.includes("wordprocessingml") ||
    file.type.includes("msword")
  ) {
    onProgress?.({ stage: "extracting", message: "Extracting text from DOCX..." });
    const arrayBuffer = await file.arrayBuffer();
    let htmlResult;
    try {
      htmlResult = await mammoth.convertToHtml({
        arrayBuffer,
        convertImage: mammoth.images.imgElement((image) =>
          image.read("base64").then((imageBuffer) =>
            ({ src: `data:${image.contentType};base64,${imageBuffer}` }),
          ),
        ),
      });
    } catch {
      htmlResult = null;
    }
    if (htmlResult?.value) {
      const parser = typeof DOMParser === "function" ? new DOMParser() : null;
      const doc = parser?.parseFromString(htmlResult.value, "text/html");
      if (doc) {
        const blocks = [];
        doc.body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,table,figure,img").forEach((element, index) => {
          const tag = element.tagName.toLowerCase();
          if (tag === "table") {
            const rows = Array.from(element.querySelectorAll("tr")).map((tr) =>
              Array.from(tr.querySelectorAll("th,td")).map((cell) => cell.textContent.trim()),
            );
            if (rows.length) blocks.push(makeBlock("table", "", { id: `docx-${index}`, rows, readingOrder: index + 1 }));
          } else if (tag === "img") {
            if (element.src) blocks.push(makeBlock("image", element.alt || "Embedded document image", {
              id: `docx-${index}`,
              assetUrl: element.src,
              assetType: element.src.split(";")[0].replace("data:", "") || "image",
              extractionStatus: "preserved_asset",
              readingOrder: index + 1,
            }));
          } else if (element.matches("figure")) {
            const image = element.querySelector("img");
            if (image?.src) blocks.push(makeBlock("image", element.textContent.trim(), {
              id: `docx-${index}`,
              assetUrl: image.src,
              extractionStatus: "preserved_asset",
              readingOrder: index + 1,
              caption: element.querySelector("figcaption")?.textContent.trim(),
            }));
          } else {
            const text = element.textContent.trim();
            if (text) {
              const type = /^h[1-6]$/.test(tag)
                ? (tag === "h1" ? "title" : "heading")
                : tag === "li" ? "list_item" : "paragraph";
              const level = /^h[1-6]$/.test(tag) ? Number(tag.slice(1)) : undefined;
              blocks.push(makeBlock(type, text, { id: `docx-${index}`, ...(level ? { level } : {}), readingOrder: index + 1 }));
            }
          }
        });
        if (blocks.length) {
          return {
            version: STRUCTURED_DOCUMENT_VERSION,
            pages: [{ pageNumber: 1, blocks }],
            blocks,
          };
        }
      }
    }
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value?.trim() || "";
    if (!text) {
      throw new Error("Could not extract any text from the Word document.");
    }
    return createStructuredDocumentFromText(text);
  }

  // PDF files
  if (fileName.endsWith(".pdf") || file.type === "application/pdf") {
    onProgress?.({ stage: "extracting", message: "Reading PDF pages..." });
    const pdfjsLib = await getPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let pageTexts = [];
    const pageLayouts = [];
    const nativeTables = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.({
        stage: "extracting",
        page: i,
        total: pdf.numPages,
        message: `Extracting page ${i} of ${pdf.numPages}...`,
      });
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const lines = [];
      const nativeTable = buildNativeTable(textContent.items, viewport.width, viewport.height);
      const tableItems = nativeTable?.yRange && nativeTable?.xRange
        ? textContent.items.filter((item) => {
            const x = Number(item.transform?.[4]) || 0;
            const y = Number(item.transform?.[5]) || 0;
            return y >= nativeTable.yRange[0] - 6 &&
              y <= nativeTable.yRange[1] + 6 &&
              x >= nativeTable.xRange[0] - 8 &&
              x <= nativeTable.xRange[1] + 8;
          })
        : [];
      const tableItemSet = new Set(tableItems);
      textContent.items.forEach((item) => {
        if (tableItemSet.has(item)) return;
        const y = Math.round(item.transform?.[5] || 0);
        let line = lines.find((entry) => Math.abs(entry.y - y) <= 3);
        if (!line) {
          line = { y, parts: [] };
          lines.push(line);
        }
        line.parts.push({ x: item.transform?.[4] || 0, text: item.str });
      });
      pageTexts.push(lines.sort((a, b) => b.y - a.y).map((line) =>
        line.parts.sort((a, b) => a.x - b.x).map((part) => part.text).join(" ").trim()
      ).filter(Boolean).join("\n"));
      pageLayouts.push({ width: viewport.width, height: viewport.height });
      if (nativeTable) {
        nativeTables.push({
          pageIndex: i - 1,
          table: nativeTable,
        });
      }
    }
    const structuredTextDocument = createStructuredDocumentFromText(pageTexts.join("\n\n"), pageTexts);
    structuredTextDocument.pages = structuredTextDocument.pages.map((page, index) => ({
      ...page,
      pageSize: pageLayouts[index],
    }));
    nativeTables.forEach(({ pageIndex, table }) => {
      const targetPage = structuredTextDocument.pages[pageIndex];
      if (!targetPage) return;
      targetPage.blocks.push(makeBlock("table", table.rows.map((row) => row.join(" | ")).join("\n"), {
        id: `native-table-${pageIndex + 1}-${targetPage.blocks.length + 1}`,
        rows: table.rows,
        headerRows: table.headerRows,
        headerRowCount: table.headerRowCount,
        columnAlignments: table.columnAlignments,
        bbox: table.bbox,
        alignment: "center",
        readingOrder: targetPage.blocks.length + 1,
        extractionStatus: "native_pdf_text",
      }));
    });

    // Native PDF text extraction can find embedded visual operators. Preserve
    // the actual rendered crop and ask Gemini only for pages that contain one.
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      if (!(await pdfPageHasVisualOperators(page, pdfjsLib))) continue;
      const imageBlob = await pdfPageToImageBlob(page);
      const visionPage = await extractTextFromImage(imageBlob, user);
      const visualBlocks = visionPage.blocks.filter((block) =>
        ["image", "illustration", "diagram", "flowchart", "chart", "graph", "math_figure", "screenshot", "visual"].includes(block.type),
      );
      if (!visualBlocks.length) continue;
      const preservedVisuals = await cropPageVisuals(page, visualBlocks, pdfjsLib);
      const targetPage = structuredTextDocument.pages[i - 1];
      targetPage.blocks.push(...preservedVisuals.map((block) => ({
        ...block,
        readingOrder: block.readingOrder ?? targetPage.blocks.length + 1,
      })));
      targetPage.blocks.sort((a, b) =>
        (a.readingOrder ?? Number.MAX_SAFE_INTEGER) - (b.readingOrder ?? Number.MAX_SAFE_INTEGER),
      );
    }
    structuredTextDocument.blocks = structuredTextDocument.pages.flatMap((page) => page.blocks);

    // Fall back to OCR if extracted PDF text is too short (likely scanned image PDF)
    if (structuredDocumentToText(structuredTextDocument).length < 50 && pdf.numPages > 0) {
      onProgress?.({
        stage: "ocr",
        message: "Scanned PDF detected. Running Gemini Vision OCR...",
      });

      const ocrPages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        onProgress?.({
          stage: "ocr",
          page: i,
          total: pdf.numPages,
          message: `Performing OCR on page ${i} of ${pdf.numPages}...`,
        });
        const page = await pdf.getPage(i);
        const imageBlob = await pdfPageToImageBlob(page);
        ocrPages.push(await extractTextFromImage(imageBlob, user));
      }

      if (ocrPages.length) {
        return {
          version: STRUCTURED_DOCUMENT_VERSION,
          pages: ocrPages.flatMap((page, index) => page.pages.map((item) => ({ ...item, pageNumber: index + 1 }))),
          blocks: ocrPages.flatMap((page) => page.blocks),
        };
      }
    }

    if (!structuredTextDocument.blocks.length) {
      throw new Error("No readable text found in the PDF.");
    }

    return structuredTextDocument;
  }

  throw new Error(
    "Unsupported file format. Please upload a PDF, DOCX, TXT, or image file.",
  );
}

/**
 * Extract text from multiple images sequentially using Gemini Vision OCR
 */
export async function extractTextFromImages(files, onProgress, user) {
  let combinedText = [];

  for (let i = 0; i < files.length; i++) {
    onProgress?.({
      stage: "ocr",
      page: i + 1,
      total: files.length,
      message: `Scanning page ${i + 1} of ${files.length}...`,
    });

    const pageText = await extractTextFromImage(files[i], user);
    if (pageText) {
      combinedText.push(pageText);
    }
  }

  const result = {
    version: STRUCTURED_DOCUMENT_VERSION,
    pages: combinedText.flatMap((page, index) =>
      page.pages.map((item) => ({ ...item, pageNumber: index + 1 })),
    ),
    blocks: combinedText.flatMap((page) => page.blocks),
  };
  if (!result.blocks.length) {
    throw new Error("No readable text could be detected across the pages.");
  }

  return result;
}

/**
 * Format raw text string into paragraph array for ReaderScreen
 */
export function formatTextToParagraphs(rawText) {
  if (!rawText) return [];
  const rawParagraphs = rawText
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);

  if (rawParagraphs.length > 0) {
    return rawParagraphs;
  }

  // Fallback: chunk long text by sentences if no paragraph breaks
  const sentences = (rawText.match(/[^.!?]+[.!?]?/g) || []).map((s) => s.trim());
  const paragraphs = [];
  let chunk = [];

  for (const sentence of sentences) {
    chunk.push(sentence);
    if (chunk.length >= 3) {
      paragraphs.push(chunk.join(" "));
      chunk = [];
    }
  }
  if (chunk.length > 0) {
    paragraphs.push(chunk.join(" "));
  }

  return paragraphs.length > 0 ? paragraphs : [rawText.trim()];
}
