import { isGate1OnlyResult } from "./isGate1OnlyResult";
import { isTargetCompanyGateResult } from "./isTargetCompanyGateResult";
import type { CandidateResult } from "./types";

/**
 * Pick, not the full CandidateResult — task #98 (2026-08-28) reuses these
 * same functions on ScreeningRecord (Pipeline tab, All Candidates page),
 * which has matching field names/shapes for everything below but isn't
 * CandidateResult itself. Narrowing to only the fields actually read makes
 * that reuse a structural-typing fit automatically, no adapter needed.
 */
type ReasonedResult = Pick<
  CandidateResult,
  | "gate1Only"
  | "checklistEvaluation"
  | "summary"
  | "targetCompanyGateFailed"
  | "archiveReason"
  | "score"
  | "credibility"
  | "fraudRisk"
  | "mustHaveScore"
  | "targetCompanyMatches"
>;

/**
 * ResultCard redesign, 2026-08-28 — replaces the old bare "Must-have 9 /
 * Nice-to-have 6" badges and the standalone target-company chip with
 * reasoned, tap-to-expand output: a small "screening progress" stepper
 * showing which checks this candidate has actually been through (Gate 1 ->
 * Gate 2 -> Credibility -> Fraud), plus a short row of attribute pills for
 * facts about the candidate (domain fit, target company match). The stepper
 * is a SEQUENCE (what stages ran, in order) — deliberately separate from the
 * attribute pills (facts, not stages), per Vlad's own framing: "like a
 * Recruiter is talking to Recruiting Manager..." — this is the visible
 * surface of that same chain-of-checks idea.
 */

export interface ScreeningStep {
  key: "gate1" | "gate2" | "credibility" | "fraud";
  label: string;
  state: "done" | "flagged" | "failed" | "not-run";
  reason?: string;
}

export interface AttributePill {
  tone: "positive" | "info" | "negative";
  label: string;
  reason?: string;
}

function buildGate1Step(result: ReasonedResult): ScreeningStep | null {
  if (isGate1OnlyResult(result)) {
    const failedReasons = (result.checklistEvaluation?.results ?? [])
      .filter((r) => !r.fired)
      .map((r) => r.reasoning)
      .filter(Boolean);
    return {
      key: "gate1",
      label: "Gate 1",
      state: "failed",
      reason: failedReasons.length > 0 ? failedReasons.join(" ") : "Archived at Gate 1 — did not clear the initial checklist.",
    };
  }
  if (result.checklistEvaluation) {
    return { key: "gate1", label: "Gate 1", state: "done", reason: "Cleared the initial checklist, moved on to full scoring." };
  }
  return null;
}

function buildGate2Step(result: ReasonedResult): ScreeningStep {
  if (isGate1OnlyResult(result)) {
    return { key: "gate2", label: "Gate 2", state: "not-run", reason: "Archived at Gate 1 — never reached full scoring." };
  }
  return { key: "gate2", label: "Gate 2", state: "done", reason: `Scored ${result.score} against the job description.` };
}

function buildCredibilityStep(result: ReasonedResult): ScreeningStep {
  if (!result.credibility) {
    return { key: "credibility", label: "Credibility", state: "not-run" };
  }
  const flagged = (result.credibility.scoreDelta ?? 0) < 0;
  const discrepancies = (result.credibility.rows ?? []).filter((r) => r.status === "discrepancy");
  const reason = flagged && discrepancies.length > 0
    ? discrepancies.map((r) => `${r.field}: ${r.note ?? `resume says "${r.resume}", cross-reference says "${r.crossRef}"`}`).join(" ")
    : flagged
    ? (result.credibility.trajectoryNote ?? "Cross-reference check found something worth a look.")
    : "Cross-reference check found no discrepancies.";
  return { key: "credibility", label: "Credibility", state: flagged ? "flagged" : "done", reason };
}

function buildFraudStep(result: ReasonedResult): ScreeningStep {
  if (!result.fraudRisk) {
    return { key: "fraud", label: "Fraud check", state: "not-run" };
  }
  const flagged = result.fraudRisk.overallRisk !== "low";
  return { key: "fraud", label: "Fraud check", state: flagged ? "flagged" : "done", reason: result.fraudRisk.summary };
}

export function buildScreeningSteps(result: ReasonedResult): ScreeningStep[] {
  // Target-company-gate candidates already render their own dedicated
  // "filtered out" message block — no stepper needed, nothing else ran.
  if (isTargetCompanyGateResult(result)) return [];

  const steps: ScreeningStep[] = [];
  const gate1 = buildGate1Step(result);
  if (gate1) steps.push(gate1);
  steps.push(buildGate2Step(result));
  steps.push(buildCredibilityStep(result));
  steps.push(buildFraudStep(result));
  return steps;
}

export function buildAttributePills(result: ReasonedResult): AttributePill[] {
  const pills: AttributePill[] = [];

  if (result.mustHaveScore !== undefined) {
    if (result.mustHaveScore >= 80) {
      pills.push({ tone: "positive", label: "Domain fit: strong" });
    } else if (result.mustHaveScore >= 50) {
      pills.push({ tone: "info", label: "Domain fit: moderate" });
    } else {
      pills.push({ tone: "negative", label: "Domain fit: weak" });
    }
  }

  if (result.targetCompanyMatches && result.targetCompanyMatches.length > 0) {
    pills.push({
      tone: "positive",
      label: "Target company match",
      reason: `Matched: ${result.targetCompanyMatches.join(", ")}`,
    });
  }

  return pills;
}
