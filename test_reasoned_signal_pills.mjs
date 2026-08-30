// Plain-Node verification of buildScreeningSteps + buildAttributePills
// (lib/reasonedSignalPills.ts) — mirrors their logic directly, same
// established plain-mirror convention as the other test_*.mjs files. Run:
// node test_reasoned_signal_pills.mjs

const NO_TARGET_COMPANY_MATCH_REASON = "No target company match found";

function isGate1OnlyResult(result) {
  if (result.gate1Only === true) return true;
  return Boolean(result.checklistEvaluation) && !result.summary;
}
function isTargetCompanyGateResult(result) {
  if (result.targetCompanyGateFailed === true) return true;
  return result.archiveReason === NO_TARGET_COMPANY_MATCH_REASON && !result.summary;
}

function buildGate1Step(result) {
  if (isGate1OnlyResult(result)) {
    const failedReasons = (result.checklistEvaluation?.results ?? []).filter((r) => !r.fired).map((r) => r.reasoning).filter(Boolean);
    return { key: "gate1", label: "Gate 1", state: "failed", reason: failedReasons.length > 0 ? failedReasons.join(" ") : "Archived at Gate 1 — did not clear the initial checklist." };
  }
  if (result.checklistEvaluation) {
    return { key: "gate1", label: "Gate 1", state: "done", reason: "Cleared the initial checklist, moved on to full scoring." };
  }
  return null;
}
function buildGate2Step(result) {
  if (isGate1OnlyResult(result)) return { key: "gate2", label: "Gate 2", state: "not-run", reason: "Archived at Gate 1 — never reached full scoring." };
  return { key: "gate2", label: "Gate 2", state: "done", reason: `Scored ${result.score} against the job description.` };
}
function buildCredibilityStep(result) {
  if (!result.credibility) return { key: "credibility", label: "Credibility", state: "not-run" };
  const flagged = (result.credibility.scoreDelta ?? 0) < 0;
  const discrepancies = (result.credibility.rows ?? []).filter((r) => r.status === "discrepancy");
  const reason = flagged && discrepancies.length > 0
    ? discrepancies.map((r) => `${r.field}: ${r.note ?? `resume says "${r.resume}", cross-reference says "${r.crossRef}"`}`).join(" ")
    : flagged ? (result.credibility.trajectoryNote ?? "Cross-reference check found something worth a look.")
    : "Cross-reference check found no discrepancies.";
  return { key: "credibility", label: "Credibility", state: flagged ? "flagged" : "done", reason };
}
function buildFraudStep(result) {
  if (!result.fraudRisk) return { key: "fraud", label: "Fraud check", state: "not-run" };
  const flagged = result.fraudRisk.overallRisk !== "low";
  return { key: "fraud", label: "Fraud check", state: flagged ? "flagged" : "done", reason: result.fraudRisk.summary };
}
function buildScreeningSteps(result) {
  if (isTargetCompanyGateResult(result)) return [];
  const steps = [];
  const gate1 = buildGate1Step(result);
  if (gate1) steps.push(gate1);
  steps.push(buildGate2Step(result));
  steps.push(buildCredibilityStep(result));
  steps.push(buildFraudStep(result));
  return steps;
}
function buildAttributePills(result) {
  const pills = [];
  if (result.mustHaveScore !== undefined) {
    if (result.mustHaveScore >= 80) pills.push({ tone: "positive", label: "Domain fit: strong" });
    else if (result.mustHaveScore >= 50) pills.push({ tone: "info", label: "Domain fit: moderate" });
    else pills.push({ tone: "negative", label: "Domain fit: weak" });
  }
  if (result.targetCompanyMatches && result.targetCompanyMatches.length > 0) {
    pills.push({ tone: "positive", label: "Target company match", reason: `Matched: ${result.targetCompanyMatches.join(", ")}` });
  }
  return pills;
}

let failures = 0;
function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`); } else { console.log(`PASS: ${label}`); }
}
function assertTrue(cond, label) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`); } else { console.log(`PASS: ${label}`); }
}

// --- buildScreeningSteps ---
const gate1Only = { checklistEvaluation: { results: [{ itemId: "1", fired: false, reasoning: "Missing required cert." }], scoreDelta: 0 }, summary: "" };
const stepsGate1Only = buildScreeningSteps(gate1Only);
assertEqual(stepsGate1Only[0].state, "failed", "Gate-1-only result -> gate1 step is 'failed'");
assertEqual(stepsGate1Only[1].state, "not-run", "Gate-1-only result -> gate2 step is 'not-run'");

const normalCandidate = { checklistEvaluation: { results: [{ itemId: "1", fired: true, reasoning: "Matched." }], scoreDelta: 5 }, summary: "A summary.", score: 84 };
const stepsNormal = buildScreeningSteps(normalCandidate);
assertEqual(stepsNormal[0].state, "done", "normal Gate-2 candidate -> gate1 step is 'done'");
assertEqual(stepsNormal[1].state, "done", "normal Gate-2 candidate -> gate2 step is 'done'");
assertEqual(stepsNormal[2].state, "not-run", "no credibility check run -> credibility step is 'not-run'");
assertEqual(stepsNormal[3].state, "not-run", "no fraud check run -> fraud step is 'not-run'");

const withFlaggedCredibility = { ...normalCandidate, credibility: { rows: [{ field: "Acme tenure", resume: "2023", crossRef: "2022", status: "discrepancy", note: "1yr off" }], scoreDelta: -5, trajectoryNote: "x", industryNote: "y", overallSignal: "minor_concerns" } };
const stepsFlagged = buildScreeningSteps(withFlaggedCredibility);
assertEqual(stepsFlagged[2].state, "flagged", "negative credibility scoreDelta -> credibility step is 'flagged'");
assertTrue(stepsFlagged[2].reason.includes("Acme tenure"), "flagged credibility step's reason cites the actual discrepancy field");

const targetCompanyGate = { targetCompanyGateFailed: true, summary: "" };
assertEqual(buildScreeningSteps(targetCompanyGate), [], "target-company-gate result -> empty stepper (own dedicated message block instead)");

// --- buildAttributePills ---
assertEqual(buildAttributePills({ mustHaveScore: 85 }), [{ tone: "positive", label: "Domain fit: strong" }], "mustHaveScore >= 80 -> strong");
assertEqual(buildAttributePills({ mustHaveScore: 60 }), [{ tone: "info", label: "Domain fit: moderate" }], "mustHaveScore 50-79 -> moderate");
assertEqual(buildAttributePills({ mustHaveScore: 30 }), [{ tone: "negative", label: "Domain fit: weak" }], "mustHaveScore < 50 -> weak");
assertEqual(buildAttributePills({}), [], "mustHaveScore undefined -> no domain-fit pill at all");

const withTargetCompany = buildAttributePills({ mustHaveScore: 90, targetCompanyMatches: ["Google", "Meta"] });
assertEqual(withTargetCompany.length, 2, "mustHaveScore + targetCompanyMatches -> 2 pills");
assertTrue(withTargetCompany[1].reason.includes("Google") && withTargetCompany[1].reason.includes("Meta"), "target company pill's reason lists the matched companies");

console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
