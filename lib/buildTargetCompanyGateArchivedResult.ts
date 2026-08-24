import { extractCandidateNameFromText } from "./extractCandidateNameFallback";
import type { CandidateResult } from "./types";

/**
 * Target-company pre-score gate, 2026-08-24 (Vlad's ask: "add a toggle...
 * when the candidate doesn't have a company that is listed in the score
 * boost companies list in their resume, then it gets filtered out"). Builds
 * the stand-in CandidateResult for a candidate whose resume matched none of
 * the project's configured target companies while
 * Project.requireTargetCompanyMatch is on — scoreCandidate()/
 * generateFingerprint() and the checklist Gate 1 evaluation never run for
 * these, so this is the ONLY place their result object gets constructed.
 * Mirrors lib/buildGate1ArchivedResult.ts's shape/rationale exactly, just
 * one gate earlier in the pipeline (this runs BEFORE Gate 1, since it's
 * cheaper — no AI call at all beyond the same lightweight name-extraction
 * fallback Gate 1's stand-in also uses).
 *
 * Every AI-judgment field (summary/strengths/concerns/careerTrajectory/
 * trajectoryEntries/checklistEvaluation) is deliberately empty, not a
 * placeholder to "fill in later" — this candidate genuinely never got that
 * read. The archived-candidate card branches on
 * lib/isTargetCompanyGateResult.ts to show a plain "no target company
 * match" message instead of expecting these fields to be populated.
 */
export async function buildTargetCompanyGateArchivedResult(params: {
  fileName: string;
  resumeText: string;
}): Promise<CandidateResult> {
  const { fileName, resumeText } = params;

  const candidateName = (await extractCandidateNameFromText(resumeText)) ?? "Unknown";

  return {
    fileName,
    candidateName,
    // No score is meaningful here — this candidate was never evaluated
    // against the JD at all. 0 keeps it out of any "top scores" sort and
    // guarantees saveScreening's below-threshold auto-archive branch fires
    // even for a project with scoreThreshold at its floor.
    score: 0,
    mustHaveScore: undefined,
    niceToHaveScore: undefined,
    summary: "",
    strengths: [],
    concerns: [],
    careerTrajectory: undefined,
    trajectoryEntries: [],
    targetCompanyMatches: [],
    targetCompanyGateFailed: true,
    // Never proceeded far enough to earn a real recommendation — same
    // "non-optional field, definitionally not a proceed" reasoning as
    // buildGate1ArchivedResult.ts's own recommendation field.
    recommendation: "decline",
  };
}
