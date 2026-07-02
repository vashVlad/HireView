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
        description: `Rich prose narrative of the candidate's full career arc — written in flowing paragraphs, no bullet points or lists. Cover every role in the candidate's history (oldest to most recent). For each role: identify the company and what it does — use your training knowledge for recognisable companies; if you do not recognise a company, say 'company not found' and infer its focus from the job title and description provided. State whether that company's domain aligns with the role being hired for (strong alignment, partial alignment, or unrelated). Determine the likely employment type: full-time or contract/consulting — infer this from tenure length, title signals such as 'Consultant', 'Contract', 'Freelance', or 'via [staffing agency]', or a pattern of consecutive short-tenure roles (under 12 months) at different companies. Note how long the candidate stayed in each role. Then analyse each career transition: does the move from one role to the next make logical sense? Does it represent a natural progression, a deliberate pivot, or an unexplained jump? Look for and name patterns: a long full-time role followed by a chain of short contracts often signals a layoff or departure with the candidate bridging while job hunting; a domain pivot with no bridging role may indicate a deliberate career change or opportunistic jump; a seniority regression may reflect a gap fill or a company-size trade-off. Synthesise all of this into a recruiter-readable story told in prose — what happened, why the moves likely happened, whether the arc points naturally toward this role or represents a stretch, and what a recruiter should carry into the conversation with this person. Be specific and draw confident inferences from the evidence. Acknowledge uncertainty where genuine but do not hedge on things the evidence clearly supports.`,
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

CAREER TRAJECTORY: Rich prose narrative, multiple paragraphs. For each role: company focus (use training knowledge; if unknown, say "company not found" and infer from title/description), domain alignment with this role, employment type (full-time or contract — infer from tenure, title signals, short consecutive roles), and tenure. Analyse every transition: does it make sense? Name patterns (contract chain after FT = likely bridge while job hunting; domain pivot; seniority regression). Synthesise into a recruiter-readable career story — what happened, why, and what it means for this candidate's fit. No bullet points. Confident inferences from evidence.

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
