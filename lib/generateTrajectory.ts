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
      // Added 2026-08-04 (Vlad's ask: FunnelView Excel export needs a
      // "Current Company" / "Current Title" column). Extracted here rather
      // than as a separate Claude call — this function already reads the
      // whole resume and already identifies the most recent role for the
      // trajectory narrative, so this is the same read, just also returned
      // as two clean structured fields instead of only living inside prose.
      currentCompany: {
        type: "string",
        description: `The candidate's most recent (or current, if still employed there) employer — company name only, no extra description. If the resume genuinely doesn't name an employer, use "Not specified".`,
      },
      currentTitle: {
        type: "string",
        description: `The candidate's most recent (or current) job title at currentCompany, as written on the resume. If the resume genuinely doesn't name a title, use "Not specified".`,
      },
      // Added 2026-08-04 (Vlad's follow-up ask: the export's "Total
      // experience" column was too long — "just literally main points of
      // the trajectory... just enough information to trust it", then
      // tightened further same day to "2 sentences max, 1 preferred").
      // Deliberately a SEPARATE field from careerTrajectory rather than a
      // truncated/extracted version of it — careerTrajectory's own format
      // (2-3 sentences per role + a closing recommendation paragraph) is an
      // established, deliberately-tuned design used on-screen elsewhere
      // (ResultCard, Interview view) and stays untouched here. This field is
      // facts only, no opinion/recommendation, short enough to scan in one
      // Excel cell.
      totalExperienceSummary: {
        type: "string",
        description: `1 sentence preferred, 2 sentences ABSOLUTE MAX (never more): total years of relevant experience, primary domain/industry, and current seniority level. Facts only — no opinion, no recommendation. Example (1 sentence, preferred): "8 years in backend engineering, mostly fintech, currently a Staff Engineer." Only use a second sentence if one genuinely can't cover it — never a third.`,
      },
    },
    required: ["careerTrajectory", "currentCompany", "currentTitle", "totalExperienceSummary"],
  },
};

export interface TrajectoryResult {
  careerTrajectory: string;
  currentCompany: string;
  currentTitle: string;
  totalExperienceSummary: string;
}

export async function generateTrajectory(
  jobDescription: string,
  resumeText: string
): Promise<TrajectoryResult> {
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

Also separately report the candidate's current (most recent) employer and job title as clean, standalone values, plus a total-experience summary (years, domain, seniority) — 1 sentence preferred, 2 sentences absolute max, facts only, no opinion.

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

  const input = toolUse.input as TrajectoryResult;
  return {
    careerTrajectory: input.careerTrajectory,
    currentCompany: input.currentCompany,
    currentTitle: input.currentTitle,
    totalExperienceSummary: input.totalExperienceSummary,
  };
}
