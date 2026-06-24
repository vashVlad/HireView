import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";
import type { CalibrationExample, CandidateResult } from "./types";

const SCORE_TOOL = {
  name: "submit_score",
  description: "Submit the candidate's score and evaluation against the job description.",
  input_schema: {
    type: "object" as const,
    properties: {
      candidateName: {
        type: "string",
        description: "The candidate's full name as found on the resume.",
      },
      score: {
        type: "number",
        description:
          "Overall 0-100 score: (mustHaveScore × 0.65) + (niceToHaveScore × 0.35), rounded to the nearest integer.",
      },
      mustHaveScore: {
        type: "number",
        description:
          "0-100 score for must-have requirements only. 100 means every must-have is clearly met; 0 means none are. A candidate who meets all must-haves should score 80+. Partial or practical-equivalent matches (e.g. 4 years depth vs. 8 years required) score 60-79. Missing a must-have entirely scores below 40 for that dimension.",
      },
      niceToHaveScore: {
        type: "number",
        description:
          "0-100 score for nice-to-have requirements only. Missing all nice-to-haves is normal and should not score below 20. A candidate who hits most of them scores 70-90.",
      },
      summary: {
        type: "string",
        description:
          "Poor match: 1 sentence naming the key missing must-haves. Partial match: 1–2 sentences on core coverage and gaps. Strong match: 2 precise sentences on fit and any notable gaps.",
      },
      strengths: {
        type: "array",
        items: { type: "string" },
        description:
          "Poor match: 0–1 items. Partial match: 2 items. Strong match: 2–4 items. Only list must-have or nice-to-have requirements the candidate clearly meets.",
      },
      concerns: {
        type: "array",
        items: { type: "string" },
        description:
          "Poor match: 1–2 items covering only the most critical missing must-haves. Partial match: 2–3 items. Strong match: 2–4 items. Must-have gaps first; skip minor or learnable gaps.",
      },
    },
    required: ["candidateName", "score", "mustHaveScore", "niceToHaveScore", "summary", "strengths", "concerns"],
  },
};

function buildCalibrationBlock(calibrationExamples: CalibrationExample[]): string {
  const examples = calibrationExamples
    .map((example) => {
      const verdict = example.label === "good" ? "HIREABLE" : "NOT HIREABLE";
      const note = example.note ? `Recruiter's note: ${example.note}\n` : "";
      return `EXAMPLE — recruiter marked this candidate ${verdict}\n${note}${example.extractedText}`;
    })
    .join("\n\n---\n\n");

  return `The recruiter has provided example resumes from past candidates they advanced or rejected for this type of role. Use these as anchors — they show what a hireable candidate looks like in practice, not as additional requirements to match against. If the candidate being evaluated has a similar depth, relevance, and coverage of core requirements as the HIREABLE examples, that should be reflected positively in their score.

${examples}`;
}

export async function scoreCandidate(
  jobDescription: string,
  fileName: string,
  resumeText: string,
  calibrationExamples: CalibrationExample[] = []
): Promise<CandidateResult> {
  const content: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> = [];

  if (calibrationExamples.length > 0) {
    content.push({
      type: "text",
      text: buildCalibrationBlock(calibrationExamples),
      cache_control: { type: "ephemeral" },
    });
  }

  content.push(
    {
      type: "text",
      text: `Today's date is ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}. Use this when interpreting employment dates on resumes — do not flag past dates as future or current.

You are evaluating a resume for a recruiter who needs to decide whether to advance this candidate.

SCORING APPROACH:
- Must-have requirements (non-negotiable skills, qualifications, or experience) drive ~65% of the score.
- Nice-to-have requirements (preferred but not required) drive ~35%.
- A score of 65–80 means the candidate covers the core requirements well and is worth advancing — even if they don't hit every bullet point.
- Reserve 80–90 for near-exceptional matches. Scores above 90 should be rare.
- No real candidate will match 100% of a job description. Do not penalize for gaps on learnable or secondary requirements.

HOW TO IDENTIFY MUST-HAVES vs. NICE-TO-HAVES:
- Phrases like "required", "must have", or skills listed under a "Requirements" section = must-haves.
- Phrases like "preferred", "nice to have", "a plus", or skills under a "Preferred" / "Bonus" section = nice-to-haves.
- When the JD is ambiguous, treat the 3–5 skills or qualifications most central to the role as must-haves.

EXPERIENCE FORMATTING:
- Express experience gaps as compact ratios, not sentences. Format: "Insurance experience: 5/8 yrs" or "Sales engineering: 2/5 yrs". Use this format whenever a candidate has some experience but falls short of the requirement.
- If a candidate has zero experience in a required area, just name it: "No enterprise sales experience".

PRACTICAL EQUIVALENCE:
- "Close enough" counts. If the JD asks for 8+ years but the candidate has 4–5 years with clear depth in the domain, treat that as a strong partial match — not a zero.
- A candidate who meets all must-haves but misses some nice-to-haves should still score in the 65–75 range.

RESPONSE VERBOSITY — scale your output to match how strong the match is:
- Poor match (score will be under 30): 1-sentence summary naming the key missing must-haves. 1–2 concerns only. Skip strengths entirely or list one at most.
- Partial match (score 30–50): 1–2 sentence summary. 2 strengths, 2–3 concerns focused on must-have gaps.
- Strong match (score 50+): Full 2-sentence summary. 2–4 strengths, 2–4 concerns, precise and specific.

Only assess what is written in the resume against what the job description asks for${calibrationExamples.length > 0 ? " and the calibration anchors above" : ""}. Do not factor in company prestige, career trajectory, or market comparisons.

JOB DESCRIPTION:
${jobDescription}`,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: `RESUME:\n${resumeText}`,
    }
  );

  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    tools: [{ ...SCORE_TOOL, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: "submit_score" },
    messages: [{ role: "user", content }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a score");
  }

  const input = toolUse.input as Omit<CandidateResult, "fileName" | "recommendation">;

  return {
    fileName,
    ...input,
    recommendation: input.score > 50 ? "proceed" : "decline",
  };
}
