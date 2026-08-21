import { evaluateChecklist, computeChecklistPercentageScore } from "./evaluateChecklist";
import type { ChecklistEvaluation, ProjectChecklist } from "./types";

/**
 * Shared "evaluate checklist -> compare to threshold -> decide gate1Only"
 * logic — extracted 2026-08-20 (Claude Code's full-system audit flagged this
 * exact shape as duplicated in three places: app/api/screen-resumes/
 * route.ts do-not-touch original, app/api/cross-project-fit/route.ts's Tier
 * 2 pre-filter, and app/api/projects/[id]/archive-fits/[screeningId]/
 * decide/route.ts). This is the part that was genuinely IDENTICAL
 * everywhere; each call site still branches on `gate1Only` itself and does
 * its own thing in the true/false cases, because those differ meaningfully:
 *
 *   - screen-resumes/route.ts builds the gate1Only stand-in
 *     (lib/buildGate1ArchivedResult.ts) when true, or runs
 *     scoreCandidate()/generateFingerprint() concurrently when false.
 *   - archive-fits/decide/route.ts does the same stand-in build, but never
 *     needs a fingerprint (Archive Fits re-screens an already-vetted
 *     candidate, not a fresh applicant).
 *   - cross-project-fit/route.ts's Tier 2 pre-filter only needs the boolean
 *     — it's deciding whether to DROP a project from consideration, never
 *     builds a stand-in result at all. Deliberately NOT folding
 *     buildGate1ArchivedResult() into this helper for that reason: it calls
 *     extractCandidateNameFromText() internally, which can fall back to a
 *     real (small) Claude call — embedding that in a shared "decide" helper
 *     would have silently added a new per-project Claude call to Tier 2's
 *     pre-filter loop, the exact kind of cost regression this refactor is
 *     supposed to avoid, not introduce. Callers that need the full stand-in
 *     result call buildGate1ArchivedResult themselves when gate1Only is
 *     true — a single, cheap, three-line call, not worth abstracting away.
 */
export interface Gate1Decision {
  checklistEvaluation: ChecklistEvaluation | null;
  checklistScore: number | null;
  gate1Only: boolean;
}

export async function evaluateGate1(params: {
  checklist: ProjectChecklist | null;
  resumeText: string;
  scoreThreshold: number;
}): Promise<Gate1Decision> {
  const { checklist, resumeText, scoreThreshold } = params;

  const checklistEvaluation = checklist
    ? await evaluateChecklist({ resumeText, checklist }).catch((err) => {
        console.error("Checklist evaluation failed (scoring unaffected):", err);
        return null;
      })
    : null;

  const checklistScore = checklistEvaluation ? computeChecklistPercentageScore(checklistEvaluation.results) : null;
  const gate1Only = checklistEvaluation !== null && checklistScore !== null && checklistScore < scoreThreshold;

  return { checklistEvaluation, checklistScore, gate1Only };
}
