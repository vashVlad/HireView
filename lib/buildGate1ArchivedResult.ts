import { extractCandidateNameFromText } from "./extractCandidateNameFallback";
import type { CandidateResult, ChecklistEvaluation } from "./types";

/**
 * Gate 1 architecture, 2026-08-19 (Phase 2.6 — see decisions-log.md's
 * 2026-08-19 entries and memory/claude-code-handoff-2026-08-19-phase-2.6-
 * architecture.md for the full design). Builds the stand-in CandidateResult
 * for a candidate whose checklist score came in below the project's
 * scoreThreshold — scoreCandidate()/generateFingerprint() never run for
 * these, so this is the ONLY place their result object gets constructed.
 *
 * Every AI-judgment field (summary/strengths/concerns/careerTrajectory/
 * trajectoryEntries) is deliberately empty, not a placeholder to "fill in
 * later" — this candidate genuinely never got that read. The archived-
 * candidate card branches on `gate1Only` to show the matched/unmatched
 * checklist list instead of expecting these fields to be populated.
 */
export async function buildGate1ArchivedResult(params: {
  fileName: string;
  resumeText: string;
  checklistScore: number;
  checklistEvaluation: ChecklistEvaluation;
}): Promise<CandidateResult> {
  const { fileName, resumeText, checklistScore, checklistEvaluation } = params;

  const candidateName = (await extractCandidateNameFromText(resumeText)) ?? "Unknown";

  return {
    fileName,
    candidateName,
    score: checklistScore,
    // Not meaningful for a checklist-only outcome — this app's mustHave/
    // niceHave split is a scoreCandidate.ts concept, never computed here.
    mustHaveScore: undefined,
    niceToHaveScore: undefined,
    summary: "",
    strengths: [],
    concerns: [],
    careerTrajectory: undefined,
    trajectoryEntries: [],
    checklistEvaluation,
    gate1Only: true,
    // Below scoreThreshold is definitionally not a proceed — no real
    // judgment was made, but the recommendation field is non-optional.
    recommendation: "decline",
  };
}
