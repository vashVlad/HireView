import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";

const TRAJECTORY_TOOL = {
  name: "submit_trajectory",
  description: "Submit the candidate's career trajectory analysis.",
  input_schema: {
    type: "object" as const,
    properties: {
      careerTrajectory: {
        type: "string",
        // Kept in sync with lib/scoreCandidate.ts's own careerTrajectory
        // description (do-not-touch exception, 2026-08-06/2026-08-07) — both
        // paths should produce the same structure. Restructured 2026-08-07
        // (Vlad's ask): "career summary" moved to the TOP (before the role
        // breakdown) and reworded to plain progression, not a verdict — the
        // recommendation/verdict now lives ONLY in the closing paragraph.
        // Also standardized the per-role header to the bold
        // "**Company — Title, type, dates**" format scoreCandidate.ts
        // already used, which this file had drifted from. Tightened again
        // same day: the opening paragraph must name concrete progression
        // signals (promotions, seniority jumps, regressions) instead of
        // generic "moved through roles" language, at the same brevity as
        // the closing paragraph.
        description: `Career arc narrative covering every role. Start with a short opening paragraph (3–4 sentences, same brevity as the closing paragraph) summarizing the shape of the candidate's career: call out concrete progression signals — promotions, seniority/title jumps, expanding scope or ownership — or regressions — steps down in level, lateral moves, gaps — and where they've landed now. Specific and factual (e.g. "promoted from Associate to Senior Engineer within 18 months" beats "grew in responsibility"), no verdict or recommendation language — save that for the end. Then list roles in reverse chronological order — most recent role first, oldest last. For each role, write a bold header line in this exact format: **[Company Name] — [Title], [full-time or contract], [date range]**. Employment type is inferred from tenure length, title signals like "Consultant"/"Contract"/"via [staffing agency]", or consecutive short stints at different companies. Do not add a sentence after the header — go straight to 3 tight bullet points: (1) what the company does and whether its domain aligns with the role being hired for (use training knowledge; if unknown say "company not found" and infer from title/description), (2) the key signal this role adds to the candidate's story, (3) whether the transition into or out of this role makes sense. Keep bullets to one line each. After all roles, add a final short paragraph (3–4 sentences max): the clear recommendation on whether this candidate is worth a conversation and why — this is the only place the verdict belongs, not the opening paragraph.`,
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
      // Added 2026-08-06 (Vlad's ask: a "LinkedIn" link column on the
      // FunnelView Excel export). Also added to lib/scoreCandidate.ts's own
      // schema the same day so new candidates get it at screening time too —
      // this one stays the backfill path for already-screened candidates.
      linkedinUrl: {
        type: "string",
        description: `The candidate's LinkedIn profile URL, exactly as it appears in the resume's contact info/header (e.g. "linkedin.com/in/janedoe" or a full https:// URL). If the resume genuinely doesn't list one, use an empty string — do not guess or construct one from the candidate's name.`,
      },
    },
    required: ["careerTrajectory", "currentCompany", "currentTitle", "totalExperienceSummary", "linkedinUrl"],
  },
};

export interface TrajectoryResult {
  careerTrajectory: string;
  currentCompany: string;
  currentTitle: string;
  totalExperienceSummary: string;
  /** Normalized to undefined (not "") when the resume doesn't list one — see submit_trajectory's own field comment. */
  linkedinUrl?: string;
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

Open with 3-4 sentences (same brevity as the closing paragraph) naming concrete progression signals — promotions, title/seniority jumps, expanding scope — or regressions — step down, lateral move, gap — and where they've landed now. Specific over vague. No verdict here. Then list roles in reverse chronological order — most recent first, oldest last. For each role: a bold header **Company — Title, full-time or contract, dates**, no sentence after it, then 3 tight bullet points (domain alignment, key signal, transition logic — one line each). End with a short paragraph (3–4 sentences): the clear recommendation on whether this candidate is worth a conversation and why — the only place the verdict belongs.

Also separately report the candidate's current (most recent) employer and job title as clean, standalone values, plus a total-experience summary (years, domain, seniority) — 1 sentence preferred, 2 sentences absolute max, facts only, no opinion. Also report their LinkedIn profile URL if the resume lists one, exactly as written — empty string if it doesn't.

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
    linkedinUrl: input.linkedinUrl ? input.linkedinUrl : undefined,
  };
}
