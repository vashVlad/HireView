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
