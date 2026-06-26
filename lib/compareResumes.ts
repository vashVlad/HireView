import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";
import type { ResumeComparisonResult } from "./types";

const COMPARE_TOOL = {
  name: "submit_comparison",
  description: "Submit the structured resume comparison analysis.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdict: {
        type: "string",
        enum: ["consistent", "minor_tweaks", "significant_reframe", "suspicious"],
        description:
          "consistent = no meaningful differences; minor_tweaks = normal emphasis customization, nothing fabricated; significant_reframe = same experience presented in materially different ways; suspicious = factual contradictions (different dates, different companies, different titles for the same role, claimed experience that doesn't add up).",
      },
      summary: {
        type: "string",
        description: "2-3 sentences on what changed and how significant it is. Be specific.",
      },
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: {
              type: "string",
              description: "The specific part that changed, e.g. 'Title at Acme Corp', 'Employment dates at XYZ', 'Years of Python experience', 'Skills section'",
            },
            inResumeA: { type: "string", description: "What Resume A says" },
            inResumeB: { type: "string", description: "What Resume B says" },
            severity: {
              type: "string",
              enum: ["minor", "notable", "red_flag"],
              description: "minor = different emphasis, both plausibly true; notable = material difference worth asking about; red_flag = factual contradiction",
            },
          },
          required: ["field", "inResumeA", "inResumeB", "severity"],
        },
        description: "All meaningful differences found. Include everything notable, not just red flags.",
      },
      redFlags: {
        type: "array",
        items: { type: "string" },
        description:
          "Factual contradictions only: different employment dates, different companies, different titles for the same job, experience totals that don't reconcile. If none, return an empty array.",
      },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description:
                "Open-ended behavioral question. Do NOT reveal you've seen two versions of the resume. Force the candidate to commit to a specific answer that can be cross-checked against what's written.",
            },
            probes: {
              type: "string",
              description: "One sentence: the specific discrepancy or uncertainty this question is designed to surface.",
            },
          },
          required: ["question", "probes"],
        },
        description:
          "5-8 targeted interview questions. Mix: questions that verify factual claims, questions that test depth of knowledge for claimed skills, and questions that force timeline commitments. Behavioral framing — 'Tell me about a time…', 'Walk me through…', 'Describe the project where…'",
      },
    },
    required: ["verdict", "summary", "changes", "redFlags", "questions"],
  },
};

const INSTRUCTIONS = `You are comparing two versions of a resume submitted by the same candidate for different roles.

Your job has two parts:

PART 1 — FIND DIFFERENCES
Compare every factual claim between the two resumes:
- Employment dates (start/end for each company)
- Job titles at each company
- Companies listed (present in one but not the other)
- Years of experience claimed for specific skills
- Education details
- Certifications, credentials
- Quantified achievements (different numbers for the same project)

Distinguish between:
- LEGITIMATE customization: different bullets highlighted, different skills emphasized, summary rewritten — these are expected and fine
- MATERIAL differences: the same fact is stated differently in ways that can't both be true
- FABRICATION signals: experience, titles, or companies appear in one resume but not the other in a way that looks like inflation

PART 2 — BUILD QUESTIONS
Generate questions that will:
1. Force the candidate to commit to specific dates, titles, and facts without revealing you've seen two resumes
2. Test depth of knowledge for skills they've claimed — someone who truly has 5 years of Python answers differently than someone who listed it to match the JD
3. Surface timeline inconsistencies through natural follow-up questions about sequence and duration
4. Verify quantified claims ("you mentioned a 40% improvement — walk me through how that was measured")

Questions must be open-ended and behavioral. Do NOT ask "why does your resume say X" — that reveals you've caught them. Instead, ask questions that lead them to state the truth themselves.`;

export async function compareResumes(
  resumeA: { text: string; fileName: string; jobTitle: string },
  resumeB: { text: string; fileName: string; jobTitle: string }
): Promise<ResumeComparisonResult> {
  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 3000,
    tools: [COMPARE_TOOL],
    tool_choice: { type: "tool", name: "submit_comparison" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: INSTRUCTIONS,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: `RESUME A — submitted for: ${resumeA.jobTitle}\nFile: ${resumeA.fileName}\n\n${resumeA.text}`,
          },
          {
            type: "text",
            text: `RESUME B — submitted for: ${resumeB.jobTitle}\nFile: ${resumeB.fileName}\n\n${resumeB.text}`,
          },
        ],
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a comparison result");
  }

  return toolUse.input as ResumeComparisonResult;
}
