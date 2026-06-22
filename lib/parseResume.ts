import mammoth from "mammoth";

// pdfjs-dist (used by pdf-parse) calls into DOMMatrix for glyph/path transforms
// even during plain text extraction. Node has no DOMMatrix, so polyfill it.
async function ensureDOMMatrixPolyfill() {
  if (typeof globalThis.DOMMatrix !== "undefined") return;
  const DOMMatrixPolyfill = (await import("dommatrix")).default;
  (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = DOMMatrixPolyfill;
}

export async function extractResumeText(
  fileName: string,
  buffer: Buffer
): Promise<string> {
  const extension = fileName.toLowerCase().split(".").pop();

  if (extension === "pdf") {
    await ensureDOMMatrixPolyfill();
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

  throw new Error(`Unsupported file type: ${fileName}`);
}
