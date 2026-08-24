import { NO_TARGET_COMPANY_MATCH_REASON } from "./targetCompanyBoost";
import type { CandidateResult } from "./types";

/**
 * Target-company pre-score gate, 2026-08-24. `CandidateResult.
 * targetCompanyGateFailed` is only ever set in memory, right after
 * screening (app/api/screen-resumes/route.ts's own gate check) — same
 * "not written to the database" choice as gate1Only, see
 * lib/isGate1OnlyResult.ts's own comment for the full rationale. So a
 * candidate loaded fresh from a reload (Pipeline, All Candidates,
 * /candidates/[id]) never has `targetCompanyGateFailed` set at all, even
 * though they genuinely are one.
 *
 * This infers the same fact from data that DOES survive a reload: this
 * gate's stand-in result always sets archiveReason to the exact
 * NO_TARGET_COMPANY_MATCH_REASON string (a real, persisted column — unlike
 * gate1Only, which has no equivalent durable marker of its own and instead
 * infers off checklistEvaluation+empty summary) and always has an empty
 * summary (scoreCandidate() never ran to produce one).
 *
 * If this ever needs to be exact rather than inferred, the fix is a real
 * `target_company_gate_failed` column + migration, not a change to this
 * function's logic.
 */
export function isTargetCompanyGateResult(
  result: Pick<CandidateResult, "targetCompanyGateFailed" | "archiveReason" | "summary">
): boolean {
  if (result.targetCompanyGateFailed === true) return true;
  return result.archiveReason === NO_TARGET_COMPANY_MATCH_REASON && !result.summary;
}
