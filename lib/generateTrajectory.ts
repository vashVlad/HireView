import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";

const TRAJECTORY_TOOL = {
  name: "submit_trajectory",
  description: "Submit the candidate's career trajectory analysis.",
  input_schema: {
    type: "object" as const,
    properties: {
      careerTrajectory: {
        type: "string",
        description: `Career arc narrative covering every role. ALWAYS list roles in reverse chronological order — most recent role first, oldest last. For each role, write one short opening sentence (company name, what they do — use training knowledge; if unknown say "company not found" and infer from title/description — and employment type: full-time or contract, inferred from tenure length, title signals like "Consultant"/"Contract"/"via [staffing agency]", or consecutive short stints at different companies). Follow that sentence with 2–3 tight bullet points covering: domain alignment with the role being hired for, the key signal this role adds to the candidate's story, and whether the transition into or out of this role makes sense. Keep bullets short — one line each. After all roles, add a final short paragraph (3–4 sentences max) with a clear recommendation: is this candidate worth a conversation, and why or why not.`,
      },
    },
    required: ["careerTrajectory"],
  },
};

export async function generateTrajectory(
  jobDescription: string,
  resumeText: string
): Promise<string> {
  const today = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    tools: [TRAJECTORY_TOOL],
    tool_choice: { type: "tool", name: "submit_trajectory" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Today is ${today}. Do not flag past dates as future.

Analyse this candidate's career trajectory against the job description below.

List roles in reverse chronological order — most recent first, oldest last. For each role: one short sentence (company, what they do, full-time or contract), then 2–3 bullet points (domain alignment, key signal, transition logic — one line each). End with a short paragraph (3–4 sentences): clear recommendation on whether this candidate is worth a conversation and why.

JOB DESCRIPTION:
${jobDescription}

RESUME:
${resumeText}`,
          },
        ],
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a trajectory");
  }

  const input = toolUse.input as { careerTrajectory: string };
  return input.careerTrajectory;
}
