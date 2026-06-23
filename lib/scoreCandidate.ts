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
          "0-100 score for how directly the resume's stated skills, experience, and qualifications match what the job description (and any calibration examples) ask for. This is a literal match score, not a judgment call about the candidate's overall career or potential.",
      },
      summary: {
        type: "string",
        description:
          "1-2 sentences stating which requirements from the job description are and aren't matched by the resume. No commentary on career trajectory, company prestige, or market trends.",
      },
      strengths: {
        type: "array",
        items: { type: "string" },
        description:
          "2-4 specific skills, qualifications, or requirements from the job description that the resume directly matches.",
      },
      concerns: {
        type: "array",
        items: { type: "string" },
        description:
          "2-4 specific skills, qualifications, or requirements from the job description that the resume is missing or only weakly shows.",
      },
    },
    required: ["candidateName", "score", "summary", "strengths", "concerns"],
  },
};

function buildCalibrationBlock(calibrationExamples: CalibrationExample[]): string {
  const examples = calibrationExamples
    .map((example) => {
      const verdict = example.label === "good" ? "ACCEPTABLE" : "NOT ACCEPTABLE";
      const note = example.note ? `Recruiter's note: ${example.note}\n` : "";
      return `EXAMPLE — marked ${verdict} by the recruiter\n${note}${example.extractedText}`;
    })
    .join("\n\n---\n\n");

  return `The recruiter has marked the following example resumes as an acceptable or not acceptable match for this kind of role. Treat them as a literal reference, alongside the job description, for which specific skills and qualifications should count as a match.

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
      text: `You are matching a resume against a job description for a recruiter. This is a literal match, not a holistic evaluation — score how well the resume's stated skills, experience, and qualifications match what the job description asks for.

Do not comment on the candidate's career trajectory, the companies they've worked for, or how their profile compares to broader market trends or other candidates. Only assess what's actually written in the resume against what's actually asked for in the job description${calibrationExamples.length > 0 ? " and the calibration examples above" : ""}. Don't inflate or guess at qualifications the resume doesn't explicitly support.

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
