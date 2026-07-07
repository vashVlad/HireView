import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";

const QUESTIONS_TOOL = {
  name: "submit_interview_questions",
  description: "Submit a list of targeted interview questions for this candidate.",
  input_schema: {
    type: "object" as const,
    properties: {
      questions: {
        type: "array",
        description: "3 to 5 targeted interview questions. Each must be short and direct — under 15 words, no preamble, no context-setting clauses. Ask the blunt question a recruiter would actually say out loud. Do NOT write generic questions like 'Tell me about yourself.'",
        items: { type: "string" },
        minItems: 3,
        maxItems: 5,
      },
    },
    required: ["questions"],
  },
};

export async function generateInterviewQuestions(params: {
  candidateName: string;
  careerTrajectory: string;
  concerns: string[];
  jobDescription: string;
}): Promise<string[]> {
  const { candidateName, careerTrajectory, concerns, jobDescription } = params;

  const concernsBlock = concerns.length > 0
    ? `\nCONCERNS FLAGGED DURING SCREENING:\n${concerns.map((c) => `- ${c}`).join("\n")}`
    : "";

  const userContent = `You are a recruiting assistant preparing a recruiter for a call with ${candidateName}.

Write 3–5 short, direct interview questions for this candidate. Each question must be under 15 words. No preamble, no "Can you walk me through..." framing — just the direct question. Reference actual companies, transitions, or signals from their background.

Cover: gaps or short stints, unclear transitions, domain changes, anything inflated, and one question to validate their strongest signal.

JOB DESCRIPTION (role being hired for):
${jobDescription.slice(0, 800)}

CAREER STORY:
${careerTrajectory}${concernsBlock}`;

  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 600,
    tools: [QUESTIONS_TOOL],
    tool_choice: { type: "tool", name: "submit_interview_questions" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return interview questions");
  }

  const input = toolUse.input as { questions: string[] };
  return input.questions;
}
