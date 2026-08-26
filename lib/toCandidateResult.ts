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
    referrerName: s.referrerName,
    duplicateFlag: s.duplicateFlag,
    duplicateMatchId: s.duplicateMatchId,
    historyAlertType: s.historyAlertType,
    historyAlertMatchId: s.historyAlertMatchId,
    historyAlertMatchProjectId: s.historyAlertMatchProjectId,
    historyAlertMatchProjectName: s.historyAlertMatchProjectName,
    historyAlertMatchCandidateName: s.historyAlertMatchCandidateName,
    // Real bug, found 2026-08-20 (Phase 2.6 Tier 2 audit — "if you find
    // something suspicious, fix it right away"): checklistEvaluation was
    // never mapped through here, even though ScreeningRecord already carries
    // it (attachChecklistEvaluations, lib/screenings.ts) and CandidateResult
    // already has a field for it. Effect: isGate1OnlyResult(result) always
    // read false on this page's ResultCard — a gate-1-archived candidate
    // reopened via /candidates/[id] (the normal way a recruiter reviews an
    // archived candidate) silently fell back to the blank AI-summary layout
    // instead of showing the matched/unmatched checklist breakdown, even
    // though that same candidate showed it correctly right after screening
    // (app/projects/[id]/page.tsx's live results view, which never
    // round-trips through ScreeningRecord/toCandidateResult at all).
    // crossProjectNameMatchScreeningId is deliberately NOT added here — see
    // its own doc comment (lib/types.ts): that field is intentionally
    // ephemeral, screening-time-only, never persisted to ScreeningRecord.
    checklistEvaluation: s.checklistEvaluation,
    // Same class of gap as checklistEvaluation above, found 2026-08-26:
    // linkedinUrl is already carried on ScreeningRecord (attachLinkedinUrls,
    // lib/screenings.ts) but was never mapped through to CandidateResult, so
    // the LinkedIn link on ResultCard's Cross-Reference Check silently
    // disappeared the moment a candidate was reopened via /candidates/[id]
    // or the batches page, even though it showed correctly right after
    // screening.
    linkedinUrl: s.linkedinUrl,
    // Same class of gap as linkedinUrl/checklistEvaluation above, 2026-08-26:
    // githubSignal is already carried on ScreeningRecord (attachGithubSignals,
    // lib/screenings.ts) but was never mapped through to CandidateResult.
    githubSignal: s.githubSignal,
    // Same class of gap, found by the 2026-08-26 full consistency audit —
    // targetCompanyMatches had NO read-back path at all until
    // attachTargetCompanyMatches was added (lib/screenings.ts); even once
    // added, it still needed this mapping to actually reach ResultCard's
    // "Target company match" badge and TrajectoryGraph's highlighting on
    // /candidates/[id] and the batches page.
    targetCompanyMatches: s.targetCompanyMatches,
  };
}
