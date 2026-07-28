import type { CandidateResult, ScreeningRecord } from "./types";

/**
 * ScreeningRecord (read from the DB) and CandidateResult (what ResultCard
 * expects) are near-identical but not the same type. The one real
 * incompatibility: recommendation is nullable on ScreeningRecord (an old
 * screening from before this field existed) but not on CandidateResult.
 * Coalescing to "decline" is a display-only default for the rare null case
 * — it doesn't touch the stored value, and ResultCard's own status/notes/
 * credibility controls all still act on the real saved record via its own
 * `id`.
 *
 * Extracted 2026-07-28 from app/candidates/[id]/page.tsx (originally built
 * 2026-07-27 for that page alone) so app/projects/[id]/batches/[batchId]/
 * page.tsx — the durable "come back to this batch" list view — can reuse
 * the exact same mapping instead of a second, easily-drifting copy.
 */
export function toCandidateResult(s: ScreeningRecord): CandidateResult {
  return {
    id: s.id,
    fileName: s.fileName,
    candidateName: s.candidateName,
    score: s.score,
    mustHaveScore: s.mustHaveScore,
    niceToHaveScore: s.niceToHaveScore,
    summary: s.summary,
    strengths: s.strengths,
    concerns: s.concerns,
    careerTrajectory: s.careerTrajectory,
    recommendation: s.recommendation ?? "decline",
    status: s.status,
    credibility: s.credibility,
    archiveReason: s.archiveReason,
    notes: s.notes,
    linkedInMode: s.linkedInMode,
    agencyName: s.agencyName,
    duplicateFlag: s.duplicateFlag,
    duplicateMatchId: s.duplicateMatchId,
    historyAlertType: s.historyAlertType,
    historyAlertMatchId: s.historyAlertMatchId,
    historyAlertMatchProjectId: s.historyAlertMatchProjectId,
    historyAlertMatchProjectName: s.historyAlertMatchProjectName,
    historyAlertMatchCandidateName: s.historyAlertMatchCandidateName,
  };
}
