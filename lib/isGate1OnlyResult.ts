import type { CandidateResult } from "./types";

/**
 * Gate 1 architecture, 2026-08-19 (Phase 2.6). `CandidateResult.gate1Only`
 * is only ever set in memory, right after screening (lib/screenings.ts's
 * saveScreening() receives it from app/api/screen-resumes/route.ts, but it
 * is NOT written to the database — no migration was added for it, a
 * deliberate choice to avoid a schema change for what's otherwise a purely
 * cosmetic display decision). So a candidate loaded fresh from a reload
 * (Pipeline, All Candidates, /candidates/[id]) never has `gate1Only` set at
 * all, even though they genuinely are one.
 *
 * This infers the same fact from data that DOES survive a reload: a
 * gate-1-only candidate always has a `checklistEvaluation` (that's the only
 * thing that ever ran) and always has an empty `summary` (scoreCandidate()
 * never ran to produce one). A real Gate-2 candidate could theoretically
 * have an empty summary from a genuine AI hiccup, but that's rare and
 * low-stakes even if misclassified here — worst case, a normal candidate
 * shows the simpler gate-1 card instead of the full one, not a real error.
 *
 * If this ever needs to be exact rather than inferred, the fix is a real
 * `gate1_only` column + migration, not a change to this function's logic.
 */
export function isGate1OnlyResult(
  result: Pick<CandidateResult, "gate1Only" | "checklistEvaluation" | "summary">
): boolean {
  if (result.gate1Only === true) return true;
  return Boolean(result.checklistEvaluation) && !result.summary;
}
