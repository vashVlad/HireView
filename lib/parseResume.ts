import mammoth from "mammoth";
import WordExtractor from "word-extractor";

// pdfjs-dist (used by pdf-parse) calls into DOMMatrix for glyph/path transforms
// even during plain text extraction. Node has no DOMMatrix, so polyfill it.
async function ensureDOMMatrixPolyfill() {
  if (typeof globalThis.DOMMatrix !== "undefined") return;
  const DOMMatrixPolyfill = (await import("dommatrix")).default;
  (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = DOMMatrixPolyfill;
}

// In Node, pdfjs-dist normally spins up its "fake worker" by dynamically
// importing a relative "./pdf.worker.mjs" path next to its own module. That
// relative import breaks once the file is bundled/traced (e.g. on Vercel),
// throwing "Setting up fake worker failed". Pre-loading the worker module
// onto globalThis.pdfjsWorker short-circuits that lookup entirely, since
// pdfjs-dist checks for it before ever attempting the dynamic import.
async function ensurePdfWorker() {
  if (typeof (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker !== "undefined") {
    return;
  }
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = worker;
}

export async function extractResumeText(
  fileName: string,
  buffer: Buffer
): Promise<string> {
  const extension = fileName.toLowerCase().split(".").pop();

  if (extension === "pdf") {
    await ensureDOMMatrixPolyfill();
    await ensurePdfWorker();
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  }

  if (extension === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  // Legacy OLE-based Word format. mammoth only reads the modern .docx
  // (ECMA-376/zip) format, so old .doc files need a separate parser.
  if (extension === "doc") {
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    return doc.getBody();
  }

  if (extension === "txt") {
    return buffer.toString("utf-8");
  }

  throw new Error(`Unsupported file type: ${fileName}`);
}
