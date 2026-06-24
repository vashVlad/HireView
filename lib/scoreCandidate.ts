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
          "0-100 score reflecting how well the candidate covers the role's requirements, weighted by importance. Must-have requirements drive ~65% of the score; nice-to-haves drive ~35%. A score of 65-80 means the candidate covers the core requirements well and is worth advancing. 80-90 is a near-exceptional match. 90+ should be rare. Do not penalize for gaps on learnable or secondary requirements. Most hireable candidates should score 60-80.",
      },
      summary: {
        type: "string",
        description:
          "1-2 sentences on how well the candidate covers the role's core requirements and where the meaningful gaps are, if any.",
      },
      strengths: {
        type: "array",
        items: { type: "string" },
        description:
          "2-4 specific must-have or nice-to-have requirements from the job description that the candidate clearly meets or closely approximates.",
      },
      concerns: {
        type: "array",
        items: { type: "string" },
        description:
          "2-4 gaps in must-have requirements first, then nice-to-haves only if must-have coverage is already strong. Skip minor or learnable gaps that would not meaningfully affect job performance.",
      },
    },
    required: ["candidateName", "score", "summary", "strengths", "concerns"],
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
      text: `You are evaluating a resume for a recruiter who needs to decide whether to advance this candidate.

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

PRACTICAL EQUIVALENCE:
- "Close enough" counts. If the JD asks for 8+ years but the candidate has 4–5 years with clear depth in the domain, treat that as a strong partial match — not a zero.
- A candidate who meets all must-haves but misses some nice-to-haves should still score in the 65–75 range.

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
