// Plain-Node verification of buildKnownConcernsBlock + buildCredibilityContextBlock
// (lib/assessFraudRisk.ts) — mirrors their logic directly, same established
// plain-mirror convention as the other test_*.mjs files in this repo. Run:
// node test_assess_fraud_risk_reuse.mjs
//
// 2026-08-28 — reuse audit (Vlad's ask: "see if we can connect and reuse
// some of the outputs" across the AI pipeline files). Confirms the fix for
// the confirmed gap: assessFraudRisk.ts used to run blind to what the
// initial screening (and any prior credibility check) already found, so it
// could re-flag the exact same issue as a new "fraud signal."

function buildKnownConcernsBlock(concerns) {
  if (!concerns || concerns.length === 0) return "";
  return `\nThis candidate's initial screening already flagged these concerns — do NOT re-list something already covered here as a new fraud signal unless it reveals something these concerns didn't already say:\n${concerns.map((c) => `- ${c}`).join("\n")}\n`;
}

function buildCredibilityContextBlock(credibility) {
  if (!credibility) return "";
  const lines = [];
  for (const row of credibility.rows ?? []) {
    if (row.status === "discrepancy") {
      lines.push(`- Discrepancy already found: ${row.field} — resume says "${row.resume}", cross-reference says "${row.crossRef}"${row.note ? ` (${row.note})` : ""}`);
    }
  }
  for (const resolved of credibility.resolvedConcerns ?? []) {
    lines.push(`- Already resolved with evidence, not a fraud signal: ${resolved}`);
  }
  if (lines.length === 0) return "";
  return `\nA credibility cross-reference check has already run for this candidate. Its findings:\n${lines.join("\n")}\nDo not re-derive or re-flag any of the above from scratch — only add a signal here if it's genuinely separate from what's listed.\n`;
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

// --- buildKnownConcernsBlock ---
assertEqual(buildKnownConcernsBlock(undefined), "", "empty/undefined concerns -> empty string");
assertEqual(buildKnownConcernsBlock([]), "", "empty array concerns -> empty string");

const oneConcern = buildKnownConcernsBlock(["Unexplained 8-month gap at Acme Corp"]);
assertTrue(oneConcern.includes("- Unexplained 8-month gap at Acme Corp"), "single concern appears as a bullet");
assertTrue(oneConcern.includes("do NOT re-list"), "single concern includes the do-not-repeat instruction");

const twoConcerns = buildKnownConcernsBlock(["Gap at Acme", "No people-leadership title"]);
assertTrue(twoConcerns.includes("- Gap at Acme") && twoConcerns.includes("- No people-leadership title"), "multiple concerns both appear as separate bullets");

// --- buildCredibilityContextBlock ---
assertEqual(buildCredibilityContextBlock(undefined), "", "no credibility assessment -> empty string");
assertEqual(buildCredibilityContextBlock({ rows: [], resolvedConcerns: [] }), "", "credibility with no discrepancies/resolutions -> empty string");

const withDiscrepancy = buildCredibilityContextBlock({
  rows: [
    { field: "Acme Corp tenure", resume: "2023-2024", crossRef: "2022-2024", status: "discrepancy", note: "one year off" },
    { field: "Degree", resume: "BS CS", crossRef: "BS CS", status: "match" },
  ],
  resolvedConcerns: ["Employment gap explained by parental leave, per LinkedIn"],
});
assertTrue(withDiscrepancy.includes("Acme Corp tenure") && withDiscrepancy.includes("one year off"), "discrepancy row surfaces field + note, matched row excluded");
assertTrue(!withDiscrepancy.includes("BS CS"), "matching rows are not surfaced (only discrepancies)");
assertTrue(withDiscrepancy.includes("Already resolved with evidence") && withDiscrepancy.includes("parental leave"), "resolved concern surfaces as already-explained, not a new signal");
assertTrue(withDiscrepancy.includes("Do not re-derive"), "block includes the do-not-re-derive instruction");

console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
