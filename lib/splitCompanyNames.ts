import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";

/**
 * Target-company input splitting, 2026-08-24 (Vlad's ask, refined same day
 * after live use: "I still want it to recognize whether the system is
 * splitting the name of the same company or not"). The first version of
 * this (a plain `.split(/[,\n]+|\s+/)` in handleAddCompany, app/projects/
 * [id]/page.tsx) correctly turned "Google OpenAI Cognizant" into three
 * entries, but had no way to know a real multi-word company name — "Goldman
 * Sachs", "Bank of America" — isn't three separate companies. A pure
 * heuristic can't tell "Goldman Sachs" (one company) from "Google OpenAI"
 * (two) apart from world knowledge, so this now defers to a tiny Claude call
 * for exactly the ambiguous case, same "cheap deterministic path first, AI
 * only when genuinely needed" pattern as
 * lib/extractCandidateNameFallback.ts's extractNameHeuristic → AI fallback.
 *
 * Three paths, cheapest first:
 * 1. Comma or newline present → split there. Fully deterministic, zero AI
 *    calls — a recruiter who types "Goldman Sachs, Google" already
 *    disambiguated it themselves, nothing to guess.
 * 2. No comma/newline AND only one whitespace-separated token → that token
 *    IS the company, no AI call needed (covers the single-add case, by far
 *    the most common one, with zero added latency/cost).
 * 3. No comma/newline AND 2+ whitespace-separated tokens → genuinely
 *    ambiguous ("Google OpenAI Cognizant" vs. "Goldman Sachs" vs. "Bank of
 *    America Google" — could be 3, 1, or 2 companies). Only here does this
 *    call Claude to actually parse the boundaries using real-world company-
 *    name knowledge. On any failure (no API key, network error, malformed
 *    response), falls back to the original naive per-word split rather than
 *    blocking the add entirely — same "degrade, never block" convention as
 *    every other AI-assisted fallback in this app.
 */

const SPLIT_TOOL = {
  name: "submit_company_list",
  description: "Submit the individual company names found in the given text, correctly separated.",
  input_schema: {
    type: "object" as const,
    properties: {
      companies: {
        type: "array" as const,
        items: { type: "string" as const },
        description:
          "The individual company names, in the order they appear. Recognize when consecutive words form ONE well-known real company name (e.g. \"Goldman Sachs\", \"Bank of America\", \"J.P. Morgan\", \"General Electric\", \"Deutsche Bank\") and keep those together as a single entry rather than splitting every word apart. Trim whitespace. Never include empty strings.",
      },
    },
    required: ["companies"],
  },
};

function naiveWhitespaceSplit(input: string): string[] {
  return input
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export async function splitCompanyNames(input: string): Promise<string[]> {
  const trimmed = input.trim();
  if (!trimmed) return [];

  // Path 1: comma/newline present — deterministic, the recruiter already
  // disambiguated it themselves.
  if (/[,\n]/.test(trimmed)) {
    return trimmed
      .split(/[,\n]+/)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  // Path 2: single token — nothing to disambiguate.
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return tokens;

  // Path 3: genuinely ambiguous multi-word, no-comma input — ask Claude.
  try {
    const message = await getAnthropicClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 300,
      tools: [SPLIT_TOOL],
      tool_choice: { type: "tool", name: "submit_company_list" },
      messages: [
        {
          role: "user",
          content: `Split this into individual company names: "${trimmed}"`,
        },
      ],
    });
    const toolUse = message.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return naiveWhitespaceSplit(trimmed);
    const companies = (toolUse.input as { companies?: unknown }).companies;
    if (!Array.isArray(companies)) return naiveWhitespaceSplit(trimmed);
    const cleaned = companies
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.trim())
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned : naiveWhitespaceSplit(trimmed);
  } catch (err) {
    console.error("AI-assisted company-name split failed (falling back to per-word split):", err);
    return naiveWhitespaceSplit(trimmed);
  }
}
