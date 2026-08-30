// Plain-Node verification of buildExistingNarrativeBlock (lib/assessCredibility.ts)
// — mirrors its logic directly, same established plain-mirror convention as
// the other test_*.mjs files. Run: node test_assess_credibility_reuse.mjs
//
// 2026-08-28 — reuse audit. Confirms the fix: assessCredibility.ts's own
// trajectoryNote/industryNote judgments used to be read purely off raw
// resumeText, even though scoreCandidate.ts already wrote a careerTrajectory
// narrative and totalExperienceSummary for the same candidate.

function buildExistingNarrativeBlock(params) {
  const { careerTrajectory, totalExperienceSummary } = params;
  if (!careerTrajectory && !totalExperienceSummary) return "";
  const lines = [];
  if (careerTrajectory) lines.push(`Career trajectory (already written during initial screening): ${careerTrajectory}`);
  if (totalExperienceSummary) lines.push(`Total experience summary (already written during initial screening): ${totalExperienceSummary}`);
  return `\nThe initial JD-fit screening already produced a read on this candidate's background:\n${lines.join("\n")}\nBuild on this existing read rather than re-deriving it from scratch — only note something new if the resume text itself reveals more than this summary already captured.\n`;
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

assertEqual(buildExistingNarrativeBlock({}), "", "neither field present -> empty string");
assertEqual(buildExistingNarrativeBlock({ careerTrajectory: undefined, totalExperienceSummary: undefined }), "", "both explicitly undefined -> empty string");

const trajectoryOnly = buildExistingNarrativeBlock({ careerTrajectory: "Steady rise from IC to Director." });
assertTrue(trajectoryOnly.includes("Steady rise from IC to Director."), "careerTrajectory-only includes the trajectory text");
assertTrue(!trajectoryOnly.includes("Total experience summary"), "careerTrajectory-only omits the total-experience line entirely");
assertTrue(trajectoryOnly.includes("Build on this existing read"), "block includes the build-on-existing-read instruction");

const both = buildExistingNarrativeBlock({ careerTrajectory: "Steady rise.", totalExperienceSummary: "6 years in fintech ops." });
assertTrue(both.includes("Steady rise.") && both.includes("6 years in fintech ops."), "both fields present, both appear");

console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
