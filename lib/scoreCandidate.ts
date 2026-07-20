import { getAnthropicClient, CLAUDE_MODEL } from "./anthropic";
import type { CalibrationExample, CandidateResult } from "./types";

function detectLinkedInProfile(fileName: string, text: string): boolean {
  if (fileName.toLowerCase().includes("linkedin")) return true;
  const sample = text.slice(0, 1200).toLowerCase();
  const markerHits = ["linkedin.com", "recommendations", " · ", "connections"].filter((m) =>
    sample.includes(m)
  ).length;
  if (markerHits >= 2) return true;
  // Bare section headers with no resume-style labels above them
  const hasSections = /\bexperience\s*\n/i.test(sample) && /\beducation\s*\n/i.test(sample);
  const noResumeLabels = !/resume|curriculum vitae|\bcv\b/.test(sample.slice(0, 300));
  return hasSections && noResumeLabels;
}

const LINKEDIN_SCORING_NOTE = `LINKEDIN PROFILE NOTE: This document is a LinkedIn profile export, not a tailored resume.
- Profiles are written for general audiences — do not penalise for a missing role-specific summary or objective
- The Skills section reflects endorsements and personal curation, not exhaustive competency; cross-reference actual job duties described in Experience entries
- Short gaps or omitted contract/consulting roles are common on LinkedIn; interpret charitably
- Weight career trajectory signals heavily: company types, scope of responsibilities, progression pace
- Focus scoring on depth and relevance of Experience entries, not keyword density`;

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
        description: "ONE sentence only. Format: '[what fits] — gap is [the single biggest gap].' Max 25 words. No filler.",
      },
      strengths: {
        type: "array",
        items: { type: "string" },
        description: "Each item: 'Skill/area: evidence in 5 words or fewer.' Example: 'FHIR/HL7: implemented at Abridge with audit logging.' No full sentences, no elaboration. Score <30: 0-1. 30-50: 1-2. 50+: 2-4.",
      },
      concerns: {
        type: "array",
        items: { type: "string" },
        description: "Each item: 'Requirement: gap in 4-6 words.' Example: 'Health insurance ops: not evidenced.' No explanation. Must-haves first. Score <30: 1-2. 30-50: 2-3. 50+: 2-4.",
      },
      careerTrajectory: {
        type: "string",
        description: `Career arc narrative covering every role. ALWAYS list roles in reverse chronological order — most recent role first, oldest last. For each role, write a bold header line in this exact format: **[Company Name] — [Title], [full-time or contract], [date range]**. Employment type is inferred from tenure length, title signals like "Consultant"/"Contract"/"via [staffing agency]", or consecutive short stints at different companies. Do not add a sentence after the header — go straight to 3 tight bullet points: (1) what the company does and whether its domain aligns with the role being hired for (use training knowledge; if unknown say "company not found" and infer from title/description), (2) the key signal this role adds to the candidate's story, (3) whether the transition into or out of this role makes sense. Keep bullets to one line each. After all roles, add a final short paragraph (3–4 sentences max): clear recommendation on whether this candidate is worth a conversation and why.`,
      },
    },
    required: ["candidateName", "score", "mustHaveScore", "niceToHaveScore", "summary", "strengths", "concerns", "careerTrajectory"],
  },
};

// Weighting curve, 2026-07-20 (Vlad's explicit ask, do-not-touch exception —
// see memory/decisions-log.md for the full reasoning trail). Intent: the JD
// alone should drive scoring when there's little or no real screening
// experience yet for a role, but as calibration examples accumulate from
// actual recruiter decisions, they become a more precise signal than the JD
// text itself for what "qualified" really means for THIS role in practice —
// so trust in them should scale up with count, gradually, not as a hard
// cutover. Thresholds (4 / 8) are a first judgment call, not derived from any
// measured data — flagged for Vlad to confirm once he's seen it live against
// a role with a real, growing example set.
function calibrationWeightGuidance(count: number): string {
  if (count >= 8) {
    return `You have ${count} calibration examples for this role — a substantial, reliable sample built from real recruiter decisions. Weight resemblance to these HIREABLE examples' core competencies, depth, and practical experience ABOVE literal job-description requirement-matching. Treat the job description as a secondary sanity check at this point — flag only a genuine, disqualifying mismatch against it — and let these examples define what "qualified" actually looks like for this specific role, since they reflect real outcomes more precisely than the JD text can.`;
  }
  if (count >= 4) {
    return `You have ${count} calibration examples for this role — a moderate, growing sample. Weight them close to equally with the job description: let resemblance to the HIREABLE examples meaningfully raise or lower a score, not just nudge it — but don't let them override a genuine job-description must-have gap on their own.`;
  }
  return `You have ${count} calibration example${count === 1 ? "" : "s"} for this role — still a small sample. Treat the job description as primary; use ${count === 1 ? "this example" : "these examples"} only as a light, secondary signal, since ${count === 1 ? "one example isn't" : "this few aren't"} enough yet to trust as the real bar for this role. That trust should grow as more examples accumulate from real screening decisions.`;
}

function buildCalibrationBlock(calibrationExamples: CalibrationExample[]): string {
  const examples = calibrationExamples
    .map((example) => {
      const verdict = example.label === "good" ? "HIREABLE" : "NOT HIREABLE";
      const note = example.note ? `Recruiter's note: ${example.note}\n` : "";
      return `EXAMPLE — recruiter marked this candidate ${verdict}\n${note}${example.extractedText}`;
    })
    .join("\n\n---\n\n");

  return `The recruiter has provided example resumes from past candidates they advanced or rejected for this type of role — accumulated from real screening decisions on this project, not hypothetical. ${calibrationWeightGuidance(calibrationExamples.length)}

${examples}`;
}

export async function scoreCandidate(
  jobDescription: string,
  fileName: string,
  resumeText: string,
  calibrationExamples: CalibrationExample[] = [],
  roleContext?: string,
  linkedInContext?: string,
  isLinkedInOverride?: boolean
): Promise<CandidateResult> {
  const isLinkedIn = isLinkedInOverride ?? detectLinkedInProfile(fileName, resumeText);
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
${roleContext ? `\nRole context from the recruiter: ${roleContext}\n` : ""}
${isLinkedIn ? `\n${LINKEDIN_SCORING_NOTE}\n` : ""}
${isLinkedIn && linkedInContext ? `\nROLE-SPECIFIC LINKEDIN SIGNALS: ${linkedInContext}\n` : ""}
Score this resume against the job description. Must-haves drive 65%, nice-to-haves 35%.

SCORING: 65-80 = covers core requirements, worth advancing. 80-90 = near-exceptional. Above 90 = rare. Don't penalize learnable or secondary gaps.

MUST-HAVES: "required", "must have", or items in a Requirements section. NICE-TO-HAVES: "preferred", "a plus", or Preferred/Bonus sections. If ambiguous, treat the 3-5 most central skills as must-haves.

POSITION FIT: flag if seniority progression makes this role unrealistic. Don't penalize title mismatches where responsibilities overlap.

SUMMARY: One sentence. "[What fits] — gap is [single biggest gap]." 25 words max.

STRENGTHS: "Skill: evidence in 5 words." No sentences. No elaboration.

CONCERNS: "Requirement: gap in 4-6 words." No explanation. The recruiter will ask for more if they want it.

CAREER TRAJECTORY: For each role — bold header: **Company — Title, full-time or contract, dates**. No sentence after the header. Then 3 bullets: (1) company focus + domain alignment, (2) key signal, (3) transition logic. One line per bullet. End with a short paragraph (3–4 sentences): worth a conversation or not, and why.

PRACTICAL EQUIVALENCE: 4-5 years with depth vs 8+ required = strong partial match. All must-haves met + missing nice-to-haves = 65-75.

VERBOSITY: <30 = 0-1 strengths, 1-2 concerns. 30-50 = 1-2 strengths, 2-3 concerns. 50+ = 2-4 strengths, 2-4 concerns.

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
    max_tokens: 4000,
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
