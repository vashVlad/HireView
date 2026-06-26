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
        description: "Overall 0-100: (mustHaveScore × 0.65) + (niceToHaveScore × 0.35), rounded.",
      },
      mustHaveScore: {
        type: "number",
        description: "0-100 for must-haves only. All met = 80+. Practical-equivalent match = 60-79. Missing entirely = below 40.",
      },
      niceToHaveScore: {
        type: "number",
        description: "0-100 for nice-to-haves only. Missing all = floor at 20. Hitting most = 70-90.",
      },
      summary: {
        type: "string",
        description: "Score <30: 1 sentence on key gaps. 30-50: 1-2 sentences on coverage and gaps. 50+: 2 sentences on fit and gaps.",
      },
      strengths: {
        type: "array",
        items: { type: "string" },
        description: "Score <30: 0-1 items. 30-50: 2. 50+: 2-4. Only requirements the candidate clearly meets.",
      },
      concerns: {
        type: "array",
        items: { type: "string" },
        description: "Score <50: 1-2 items, 8 words max each. Score 50+: 2-4 items, 1-2 sentences each with specific context (what's missing, by how much, why it matters for this role). Must-haves first; skip learnable gaps.",
      },
      careerTrajectory: {
        type: "string",
        description: "1-3 sentences on the candidate's role progression: does the sequence of positions lead naturally toward this role, and are there any suspicious patterns (frequent job hops, unexplained gaps, sudden domain shifts, title regression, lateral moves that don't build toward this type of role).",
      },
    },
    required: ["candidateName", "score", "mustHaveScore", "niceToHaveScore", "summary", "strengths", "concerns", "careerTrajectory"],
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
      text: `Today is ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}. Do not flag past dates as future.

Score this resume against the job description. Must-haves drive 65%, nice-to-haves 35%.

SCORING: 65-80 = covers core requirements, worth advancing. 80-90 = near-exceptional. Above 90 = rare. Don't penalize learnable or secondary gaps.

MUST-HAVES: "required", "must have", or items in a Requirements section. NICE-TO-HAVES: "preferred", "a plus", or Preferred/Bonus sections. If ambiguous, treat the 3-5 most central skills as must-haves.

POSITION FIT: flag if seniority progression makes this role unrealistic. Don't penalize title mismatches where responsibilities overlap.

CONCERNS FORMAT: Score <50: 8 words max each, experience gaps as ratios ("Insurance: 5/8 yrs"). Score 50+: 1-2 sentences each — name the gap, quantify it if possible, explain why it matters for this specific role. One gap per bullet. Must-haves first; skip learnable gaps.

CAREER TRAJECTORY: Describe the sequence of roles — does it build logically toward this position? Flag suspicious patterns: frequent job changes (<1 yr per role), unexplained gaps (>6 months), sudden domain shifts, title regression, or lateral moves that don't accumulate relevant experience. If the progression is clean and logical, say so briefly.

PRACTICAL EQUIVALENCE: 4-5 years with depth vs 8+ required = strong partial match. All must-haves met + missing nice-to-haves = 65-75.

VERBOSITY: <30 = 1-sentence summary, 1-2 concerns, no strengths. 30-50 = 1-2 sentences, 2 strengths, 2-3 concerns. 50+ = 2 sentences, 2-4 strengths, 2-4 concerns.

Only assess resume vs JD${calibrationExamples.length > 0 ? " and calibration anchors above" : ""}. Ignore company prestige.

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
    max_tokens: 2000,
    tools: [{ ...SCORE_TOOL, cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: "submit_score" },
    messages: [{ role: "user", content }],
  });

  const toolUse = message.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a score");
  }

  const input = toolUse.input as Omit<CandidateResult, "fileName" | "recommendation" | "status" | "id">;

  return {
    fileName,
    ...input,
    recommendation: input.score > 50 ? "proceed" : "decline",
  };
}
