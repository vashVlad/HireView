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

export interface FraudSignals {
  duplicateFlag: boolean;
  historyAlertType?: "previously_seen" | "known_fraud_pattern";
  credibilityDiscrepancies: string[];
}

/** True if there's anything worth asking about — callers should omit fraudSignals entirely otherwise. */
export function hasFraudSignal(s: FraudSignals): boolean {
  return s.duplicateFlag || s.historyAlertType != null || s.credibilityDiscrepancies.length > 0;
}

function buildFraudBlock(s: FraudSignals): string {
  const lines: string[] = [];
  if (s.duplicateFlag) lines.push("- This resume's content matches another candidate submitted to the same role — possible identity-swap fraud.");
  if (s.historyAlertType === "known_fraud_pattern") lines.push("- This content pattern has a confirmed fraud history in another role.");
  else if (s.historyAlertType === "previously_seen") lines.push("- This content pattern was previously submitted to a different role.");
  for (const d of s.credibilityDiscrepancies) lines.push(`- Credibility check discrepancy: ${d}`);
  return lines.join("\n");
}

export async function generateInterviewQuestions(params: {
  candidateName: string;
  careerTrajectory: string;
  concerns: string[];
  jobDescription: string;
  fraudSignals?: FraudSignals;
}): Promise<string[]> {
  const { candidateName, careerTrajectory, concerns, jobDescription, fraudSignals } = params;

  const concernsBlock = concerns.length > 0
    ? `\nCONCERNS FLAGGED DURING SCREENING:\n${concerns.map((c) => `- ${c}`).join("\n")}`
    : "";

  const fraudInstructions = fraudSignals
    ? `\n\nThis candidate has fraud/credibility signals flagged. At least 2 of the questions must directly probe these specific issues — ask exactly what needs clarifying, don't soften it:\n${buildFraudBlock(fraudSignals)}\n\nThe remaining questions can cover standard role-fit topics below.`
    : "";

  const userContent = `You are a recruiting assistant preparing a recruiter for a call with ${candidateName}.

Write 3–5 short, direct interview questions for this candidate. Each question must be under 15 words. No preamble, no "Can you walk me through..." framing — just the direct question. Reference actual companies, transitions, or signals from their background.

Cover: gaps or short stints, unclear transitions, domain changes, anything inflated, and one question to validate their strongest signal.${fraudInstructions}

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
