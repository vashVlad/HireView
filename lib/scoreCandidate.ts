import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";
import type { CandidateResult } from "./types";

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
        description: "Fit score from 0-100 against the job description.",
      },
      summary: {
        type: "string",
        description: "A 2-3 sentence summary of the candidate's fit for the role.",
      },
      strengths: {
        type: "array",
        items: { type: "string" },
        description: "Key strengths relevant to the job description.",
      },
      concerns: {
        type: "array",
        items: { type: "string" },
        description: "Gaps or concerns relevant to the job description.",
      },
    },
    required: ["candidateName", "score", "summary", "strengths", "concerns"],
  },
};

export async function scoreCandidate(
  jobDescription: string,
  fileName: string,
  resumeText: string
): Promise<CandidateResult> {
  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    tools: [SCORE_TOOL],
    tool_choice: { type: "tool", name: "submit_score" },
    messages: [
      {
        role: "user",
        content: `You are screening resumes for a recruiter. Score this candidate against the job description below.

JOB DESCRIPTION:
${jobDescription}

RESUME:
${resumeText}`,
      },
    ],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a score");
  }

  const input = toolUse.input as Omit<CandidateResult, "fileName">;

  return {
    fileName,
    ...input,
  };
}
