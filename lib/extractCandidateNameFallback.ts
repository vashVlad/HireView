import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";

const NAME_TOOL = {
  name: "submit_candidate_name",
  description: "Submit the candidate's full name as it appears on the resume document.",
  input_schema: {
    type: "object" as const,
    properties: {
      candidateName: {
        type: "string",
        description: "The candidate's full name, exactly as printed on the document (header, title area, or anywhere else on the page). Empty string only if genuinely no name is visible anywhere.",
      },
    },
    required: ["candidateName"],
  },
};

/**
 * Fallback for when text-based extraction (lib/parseResume.ts, do-not-touch)
 * misses the candidate's name entirely. Confirmed real-world cause (Teti's
 * bug report, 2026-07-13, "Unknown (resume name not provided)"): some PDF
 * export tools — confirmed here: Google Docs' "Download as PDF" — place the
 * header region (name/title/contact) outside the extractable text layer
 * even though it's fully visible in any normal PDF viewer. pdf-parse
 * returned 18k+ characters of real body text for the reported case, but
 * zero occurrences of the candidate's actual name anywhere in it.
 *
 * Tried rendering the page to an image ourselves first (pdfjs-dist +
 * @napi-rs/canvas, avoiding the classic `canvas` package's native-binary
 * problems on serverless) — hit a real incompatibility between pdfjs-dist's
 * rendering calls and that canvas polyfill's Path2D/fill support. Not
 * something to ship. This is more robust: the Anthropic SDK already used
 * throughout this project (@anthropic-ai/sdk ^0.105.0) supports sending a
 * raw PDF as a native `document` content block — Claude reads the page
 * visually itself, no rendering needed on our end at all.
 *
 * Deliberately not called on every resume — only when scoreCandidate.ts's
 * normal candidateName output looks missing/placeholder (see
 * looksLikeMissingName below), so this extra Claude call only fires in the
 * rare case where it's actually needed.
 */
export async function extractCandidateNameFromPdf(pdfBuffer: Buffer): Promise<string | null> {
  try {
    const message = await getAnthropicClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 200,
      tools: [NAME_TOOL],
      tool_choice: { type: "tool", name: "submit_candidate_name" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfBuffer.toString("base64") },
            },
            {
              type: "text",
              text: "What is the candidate's full name on this resume? Read the page directly — the name is usually in a header or title area near the top, even if it wouldn't appear in a plain-text extraction of this file.",
            },
          ],
        },
      ],
    });

    const toolUse = message.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;
    const name = (toolUse.input as { candidateName?: string }).candidateName?.trim();
    return name && name.length > 1 ? name : null;
  } catch (err) {
    console.error("Vision-based candidate name fallback failed:", err);
    return null;
  }
}

/** True when scoreCandidate.ts's candidateName output looks like it couldn't actually find a name. */
export function looksLikeMissingName(name: string | undefined | null): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (trimmed.length < 2) return true;
  return /unknown|not provided|not found|\bn\/a\b|no name/i.test(trimmed);
}

/**
 * Text-based name extraction, 2026-08-19 (Phase 2.6 — Gate 1 architecture,
 * see decisions-log.md's 2026-08-19 entries). For a gate-1-only candidate,
 * scoreCandidate() never runs at all — so there's no other source for
 * candidateName. Deliberately NOT extractCandidateNameFromPdf above — that
 * solves a narrower, different problem (some PDF exports hide the header
 * text layer even though it's visibly there), requires a second raw-document
 * upload, and doesn't apply to .docx at all. Ordinary plain-text extraction
 * (lib/parseResume.ts, already run before Gate 1 evaluates the checklist)
 * reliably includes the name in the normal case for every file type — this
 * only needs a cheap read of text that's already sitting in memory.
 *
 * Pure heuristic first (free, no AI call at all) — a resume's name is
 * almost always one of the first few non-empty lines: short, no digits, no
 * "resume"/"cv" boilerplate, 2-4 capitalized words. Exported separately so
 * it's directly unit-testable without a live API key.
 */
export function extractNameHeuristic(resumeText: string): string | null {
  const firstLines = resumeText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);

  for (const line of firstLines) {
    if (line.length < 2 || line.length > 60) continue;
    if (/[@\d]/.test(line)) continue; // emails, phone numbers, street addresses
    if (/resume|curriculum vitae|\bcv\b/i.test(line)) continue;
    const words = line.split(/\s+/);
    if (
      words.length >= 2 &&
      words.length <= 4 &&
      words.every((w) => /^[A-Z][a-zA-Z'.-]*$/.test(w))
    ) {
      return line;
    }
  }
  return null;
}

const NAME_FROM_TEXT_TOOL = {
  name: "submit_candidate_name",
  description: "Submit the candidate's full name as it appears in this resume text.",
  input_schema: {
    type: "object" as const,
    properties: {
      candidateName: {
        type: "string",
        description: "The candidate's full name, exactly as written in the text below. Empty string only if genuinely no name is present anywhere.",
      },
    },
    required: ["candidateName"],
  },
};

/**
 * Falls back to a tiny text-only Claude call only when the free heuristic
 * above can't confidently find a name. Deliberately does NOT escalate
 * further to extractCandidateNameFromPdf on failure — this is a purely
 * cosmetic label on a Gate-1-archived candidate's card (which never got a
 * real AI read), not a scored field, so "Unknown" is an acceptable final
 * fallback rather than justifying a second, more expensive document-vision
 * call for every candidate who fails Gate 1.
 */
export async function extractCandidateNameFromText(resumeText: string): Promise<string | null> {
  const heuristic = extractNameHeuristic(resumeText);
  if (heuristic) return heuristic;

  try {
    const message = await getAnthropicClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 100,
      tools: [NAME_FROM_TEXT_TOOL],
      tool_choice: { type: "tool", name: "submit_candidate_name" },
      messages: [
        {
          role: "user",
          content: `What is the candidate's full name? Read only the resume text below.\n\n${resumeText.slice(0, 2000)}`,
        },
      ],
    });
    const toolUse = message.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;
    const name = (toolUse.input as { candidateName?: string }).candidateName?.trim();
    return name && name.length > 1 ? name : null;
  } catch (err) {
    console.error("Text-based candidate name fallback failed:", err);
    return null;
  }
}
