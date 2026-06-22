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
        description:
          "Overall fit score from 0-100, based on holistic experience and market fit for the role — not a literal JD checklist match.",
      },
      summary: {
        type: "string",
        description:
          "A 2-3 sentence summary of the candidate's overall fit for the role — their trajectory and experience as a whole, not a line-by-line match against the JD.",
      },
      strengths: {
        type: "array",
        items: { type: "string" },
        description:
          "The 2-4 most decision-relevant strengths only — not an exhaustive list. Relevant experience and transferable skills, notable companies worked at, and market-standard keywords/skills for this type of role found in the resume.",
      },
      concerns: {
        type: "array",
        items: { type: "string" },
        description:
          "The 2-4 most decision-relevant concerns only — not an exhaustive list. Missing market-standard keywords/skills for this type of role, weak company background, or experience that doesn't transfer well.",
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
    tools: [{ ...SCORE_TOOL, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: "submit_score" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You are screening resumes for a recruiter at a large company. This screening directly informs hiring decisions, so accuracy matters — be rigorous and evidence-based, and don't inflate or guess at qualifications the resume doesn't actually support.

Evaluate each candidate's overall fit for the role — don't just check the resume against the job description line by line.

Consider:
- Their overall experience and career trajectory, and how well it would transfer to this role, even if past titles or industries don't match the JD exactly.
- The companies they've worked for — their relevance, reputation, and what that signals about the caliber of work the candidate has been exposed to.
- Market-standard skills and keywords for this type of role — based on what's generally expected for this position in the current job market, not only what's explicitly written in the JD below. A strong candidate may be missing something the JD asks for but cover other skills the market considers equally important for this role, or vice versa.

Use the job description as your starting point for what this specific role needs, but weigh it against the broader picture: the candidate's overall trajectory and what the market actually expects for this kind of position.

Keep the summary, strengths, and concerns focused on only the points that would actually matter to a hiring decision — not a full inventory of everything on the resume.

JOB DESCRIPTION:
${jobDescription}`,
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: `RESUME:\n${resumeText}`,
          },
        ],
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
