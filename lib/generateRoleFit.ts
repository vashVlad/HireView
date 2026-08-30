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
 *
 * Phase 2.6 Tier "connect Archive Fits" (2026-08-20, Vlad's ask) — a
 * Gate-1-only archived candidate (lib/buildGate1ArchivedResult.ts) has none
 * of summary/strengths/careerTrajectory populated (empty by design — Gate 1
 * never runs the full scoreCandidate() pipeline), so the original
 * summary-based prompt has nothing to work from for exactly the population
 * this connection is meant to cover. `resumeText` is a second, mutually
 * exclusive input mode for that case — callers pass EITHER the summary/
 * strengths/trajectory trio (any Gate-2 candidate, existing behavior,
 * unchanged) OR raw resumeText (Gate-1-only candidates), never both. See
 * app/api/history/[id]/role-fit/route.ts for the branch that decides which.
 */
export async function generateRoleFit(candidate: {
  summary: string;
  strengths: string[];
  careerTrajectory?: string;
  resumeText?: string;
  /**
   * Reuse audit, 2026-08-28 (Vlad's ask: "see if we can connect and reuse
   * some of the outputs" across the AI pipeline files) — scoreCandidate.ts's
   * own result.concerns, previously never passed here. Lets the suggested
   * alternate role implicitly steer away from the candidate's known weak
   * points instead of only reasoning from their strengths. Only used in the
   * summary-based branch below — the resumeText branch (Gate-1-only
   * candidates) has no concerns to draw from, since no AI scoring call ever
   * ran for them.
   */
  concerns?: string[];
}): Promise<string> {
  const usingResumeText = !candidate.summary && !!candidate.resumeText;
  const promptText = usingResumeText
    ? `Based on this candidate's resume, suggest ONE short role/title they'd likely be a strong fit for. Be specific and realistic (an actual job title a recruiter would search for), not a generic category.

RESUME:
${candidate.resumeText}`
    : `Based on this candidate's profile, suggest ONE short role/title they'd likely be a stronger fit for than the role they were just archived from. Be specific and realistic (an actual job title a recruiter would search for), not a generic category.

SUMMARY:
${candidate.summary}

STRENGTHS:
${candidate.strengths.join(", ")}

CAREER TRAJECTORY:
${candidate.careerTrajectory ?? "(not available)"}${
        candidate.concerns && candidate.concerns.length > 0
          ? `\n\nCONCERNS FLAGGED IN THE ROLE THEY WERE JUST ARCHIVED FROM:\n${candidate.concerns.join(", ")}\nFactor these in — don't suggest a role that would hit the same concerns again.`
          : ""
      }`;

  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 200,
    tools: [ROLE_FIT_TOOL],
    tool_choice: { type: "tool", name: "submit_role_fit" },
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: promptText }],
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
