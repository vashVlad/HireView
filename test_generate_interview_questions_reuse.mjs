// Plain-Node verification of hasFraudSignal + buildFraudBlock
// (lib/generateInterviewQuestions.ts) — mirrors their logic directly, same
// established plain-mirror convention as the other test_*.mjs files. Run:
// node test_generate_interview_questions_reuse.mjs
//
// 2026-08-28 — reuse audit. Confirms fraudRiskSignals (assessFraudRisk.ts's
// own richer signal data) now feeds interview-question generation, not just
// the thinner credibilityDiscrepancies string list.

function hasFraudSignal(s) {
  return s.duplicateFlag || s.historyAlertType != null || s.credibilityDiscrepancies.length > 0 || (s.fraudRiskSignals?.length ?? 0) > 0;
}

function buildFraudBlock(s) {
  const lines = [];
  if (s.duplicateFlag) lines.push("- This resume's content matches another candidate submitted to the same role — possible identity-swap fraud.");
  if (s.historyAlertType === "known_fraud_pattern") lines.push("- This content pattern has a confirmed fraud history in another role.");
  else if (s.historyAlertType === "previously_seen") lines.push("- This content pattern was previously submitted to a different role.");
  for (const d of s.credibilityDiscrepancies) lines.push(`- Credibility check discrepancy: ${d}`);
  for (const f of s.fraudRiskSignals ?? []) lines.push(`- Fraud risk signal (${f.patternType}): ${f.explanation}`);
  return lines.join("\n");
}

let failures = 0;
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    failures++;
    console.error(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}
function assertTrue(cond, label) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// --- hasFraudSignal ---
assertEqual(hasFraudSignal({ duplicateFlag: false, credibilityDiscrepancies: [] }), false, "nothing flagged -> false");
assertEqual(
  hasFraudSignal({ duplicateFlag: false, credibilityDiscrepancies: [], fraudRiskSignals: [{ patternType: "inflated_title", explanation: "x" }] }),
  true,
  "fraudRiskSignals alone (no credibility discrepancy) -> true, this is the confirmed fix"
);
assertEqual(hasFraudSignal({ duplicateFlag: false, credibilityDiscrepancies: [], fraudRiskSignals: [] }), false, "empty fraudRiskSignals array -> false");

// --- buildFraudBlock ---
const block = buildFraudBlock({
  duplicateFlag: false,
  credibilityDiscrepancies: ["Acme Corp tenure off by 1 year"],
  fraudRiskSignals: [{ patternType: "fabricated_experience", explanation: "Graduated 2020, claims 8 years by 2024." }],
});
assertTrue(block.includes("Credibility check discrepancy: Acme Corp tenure off by 1 year"), "credibility discrepancy line still present");
assertTrue(block.includes("Fraud risk signal (fabricated_experience): Graduated 2020, claims 8 years by 2024."), "fraud risk signal line present with pattern type + explanation");

const blockNoFraud = buildFraudBlock({ duplicateFlag: true, credibilityDiscrepancies: [] });
assertTrue(!blockNoFraud.includes("Fraud risk signal"), "no fraudRiskSignals field at all -> no fraud-risk line, no crash");

console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
