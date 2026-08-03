import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";

// DO-NOT-TOUCH EXCEPTION (2026-07-23 — see memory/decisions-log.md): fixes a
// real, confirmed failure mode — Vlad uploaded a resume (Brillio_Resume,
// "Producer: Microsoft: Print To PDF") that pdf-parse extracts as 4
// meaningless page-marker characters. Checked with poppler's own pdftotext/
// pdffonts/pdfimages and pikepdf directly against the raw PDF structure: this
// isn't a scan and isn't corrupt — the file has ZERO font objects and ZERO
// image objects. Every glyph was exported as a filled vector outline path (m/
// c/l/h/f fill operators only, no Tj/TJ text-showing operators anywhere in
// the content stream at all). The page renders as crisp, fully legible text
// when rasterized, but there is no text anywhere in the file for any
// text-layer extractor — pdf-parse, poppler, any of them — to find. The only
// way to recover it is to read it visually, same as a human would.
//
// Rather than adding a PDF-to-image rendering pipeline (canvas/tesseract —
// canvas needs native binaries, unreliable on Vercel serverless; confirmed
// firsthand in this session's sandbox, where pdfjs-dist's own optional
// @napi-rs/canvas dependency failed to load its native binding) this sends
// the raw PDF straight to Claude as a native `document` content block —
// already a supported, stable part of the installed @anthropic-ai/sdk
// (DocumentBlockParam/Base64PDFSource) — and asks Claude to transcribe what
// it visually reads. Zero new dependencies, and only ever fires as a
// fallback below a conservative length threshold — any PDF that already
// extracts real text (the overwhelming majority) takes the exact same
// pdf-parse path as before, completely unchanged.
const MIN_MEANINGFUL_TEXT_LENGTH = 150;

const TRANSCRIBE_TOOL = {
  name: "submit_transcription",
  description: "Submit the transcribed text read visually from the document.",
  input_schema: {
    type: "object" as const,
    properties: {
      text: {
        type: "string",
        description:
          "Every word of visible text in the document, transcribed in reading order, exactly as written. No summarizing, no commentary, no markdown — the raw text only.",
      },
    },
    required: ["text"],
  },
};

async function extractPdfTextViaVision(buffer: Buffer): Promise<string> {
  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    tools: [TRANSCRIBE_TOOL],
    tool_choice: { type: "tool", name: "submit_transcription" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
          },
          {
            type: "text",
            text: "This PDF has no extractable text layer (the glyphs were exported as vector outlines, not real embedded text) — read the document visually instead, the way a person would, and transcribe it.",
          },
        ],
      },
    ],
  });
  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return "";
  const input = toolUse.input as { text: string };
  return input.text ?? "";
}

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

    if (result.text.trim().length < MIN_MEANINGFUL_TEXT_LENGTH) {
      const visionText = await extractPdfTextViaVision(buffer);
      if (visionText.trim().length < MIN_MEANINGFUL_TEXT_LENGTH) {
        throw new Error(
          `Could not extract readable text from "${fileName}" — it has no text layer and visual transcription also came back empty.`
        );
      }
      return visionText;
    }

    return result.text;
  }

  if (extension === "docx") {
    // DO-NOT-TOUCH EXCEPTION (2026-08-03 — see memory/decisions-log.md): same
    // failure class as the PDF branch's 2026-07-23 exception above, just
    // never ported to .docx. mammoth.extractRawText() has no length/emptiness
    // check of its own — an image-only, SmartArt-based, or otherwise
    // non-text-run resume silently comes back as "" or a few stray
    // characters, with no error thrown. Downstream, an empty crossRefText
    // makes assessCredibility() treat it as "no cross-reference provided"
    // (rows forced to []), but Claude can still hedge toward a non-"clean"
    // overallSignal — Vlad's report, 2026-08-03: "it said minor-concerns but
    // nothing is shown." There's no PDF-style vision fallback available here
    // (Claude has no native "read this .docx visually" mode the way it does
    // for a PDF's rendered page), so this fails loudly instead: below the
    // same MIN_MEANINGFUL_TEXT_LENGTH threshold used for PDFs, throw a clear,
    // actionable error rather than silently completing with near-empty text.
    // This surfaces exactly the same way an unsupported file type already
    // does (loadMainResume/loadCrossRef in assess-credibility/route.ts and
    // the equivalent screen-resumes path already catch and report thrown
    // errors as a real, visible error message instead of a silent bad result).
    const result = await mammoth.extractRawText({ buffer });
    if (result.value.trim().length < MIN_MEANINGFUL_TEXT_LENGTH) {
      throw new Error(
        `Could not extract readable text from "${fileName}" — it came back with little to no text (this happens with image-only or heavily graphic-design/text-box-based resumes). Try a plain-text-based .docx or a PDF instead.`
      );
    }
    return result.value;
  }

  // Legacy OLE-based Word format. mammoth only reads the modern .docx
  // (ECMA-376/zip) format, so old .doc files need a separate parser.
  //
  // DO-NOT-TOUCH EXCEPTION (2026-08-04 — see memory/decisions-log.md): same
  // gap as the .docx branch above, just never ported here either — Vlad
  // reported the credibility check "still gives an empty output" after the
  // .docx fix shipped. Reproduced directly: an empty crossRefText makes
  // assessCredibility() treat it as "no cross-reference provided" (hasCrossRef
  // = Boolean("") = false), so rows comes back [] and overallSignal "clean"
  // with zero indication anything went wrong — the exact "empty output"
  // symptom, just via .doc instead of .docx. word-extractor's getBody() has
  // no length/emptiness check of its own, same as mammoth.extractRawText().
  // Same fix, same threshold, no vision fallback available for this format
  // either (Claude has no native .doc reader the way it does for a PDF page).
  if (extension === "doc") {
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    const text = doc.getBody();
    if (text.trim().length < MIN_MEANINGFUL_TEXT_LENGTH) {
      throw new Error(
        `Could not extract readable text from "${fileName}" — it came back with little to no text (this happens with image-only or heavily graphic-design/text-box-based resumes). Try a plain-text-based .doc/.docx or a PDF instead.`
      );
    }
    return text;
  }

  if (extension === "txt") {
    return buffer.toString("utf-8");
  }

  throw new Error(`Unsupported file type: ${fileName}`);
}
