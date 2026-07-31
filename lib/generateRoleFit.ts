import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";

const ROLE_FIT_TOOL = {
  name: "submit_role_fit",
  description: "Submit a short suggested role/title this candidate would likely fit better.",
  input_schema: {
    type: "object" as const,
    properties: {
      roleFit: {
        type: "string",
        description:
          "A short role/title suggestion (e.g. \"Backend Engineer\", \"Technical Program Manager\") — 2-5 words, no explanation, no punctuation beyond the title itself.",
      },
    },
    required: ["roleFit"],
  },
};

/**
 * Suggests a short role/title a candidate would likely fit better, based on
 * their existing screening summary/strengths/trajectory — independent of any
 * specific JD. Reuses the same already-generated fields every screening
 * already has, so no resume re-parsing or extra Claude call scope creep.
 */
export async function generateRoleFit(candidate: {
  summary: string;
  strengths: string[];
  careerTrajectory?: string;
}): Promise<string> {
  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 200,
    tools: [ROLE_FIT_TOOL],
    tool_choice: { type: "tool", name: "submit_role_fit" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Based on this candidate's profile, suggest ONE short role/title they'd likely be a stronger fit for than the role they were just archived from. Be specific and realistic (an actual job title a recruiter would search for), not a generic category.

SUMMARY:
${candidate.summary}

STRENGTHS:
${candidate.strengths.join(", ")}

CAREER TRAJECTORY:
${candidate.careerTrajectory ?? "(not available)"}`,
          },
        ],
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a role fit suggestion");
  }

  const input = toolUse.input as { roleFit: string };
  return input.roleFit.trim();
}
