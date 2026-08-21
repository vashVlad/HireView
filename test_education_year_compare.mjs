// Plain-Node verification of lib/compareEducationYear.ts — reimplemented
// inline (same convention as test_embeddings_pure.mjs / test_trajectory_match.mjs).
// Run: node test_education_year_compare.mjs

function compareEducationYear(resumeYear, crossRefStartYear, crossRefEndYear) {
  if (resumeYear == null || (crossRefStartYear == null && crossRefEndYear == null)) {
    return { status: "cannot_verify" };
  }
  const diffs = [];
  if (crossRefStartYear != null) diffs.push(resumeYear - crossRefStartYear);
  if (crossRefEndYear != null) diffs.push(resumeYear - crossRefEndYear);
  const withinMatchRange = diffs.some((d) => d >= -1 && d <= 1);
  if (withinMatchRange) return { status: "match" };
  const minDistance = Math.min(...diffs.map((d) => Math.abs(d)));
  if (minDistance <= 2) return { status: "discrepancy", severity: "minor" };
  return { status: "discrepancy", severity: "material" };
}

let failures = 0;
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) {
    failures++;
    console.error(`FAIL: ${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(actual)}`);
  } else {
    console.log(`PASS: ${name}`);
  }
}

// Worked examples straight from the old CREDIBILITY_TOOL schema's own description
check(
  '"Expected 2029" vs range ending 2029 (Jan 2026 – Dec 2029) — 2029-2029=0 — match',
  compareEducationYear(2029, 2026, 2029),
  { status: "match" }
);
check(
  '"2024" vs range ending Nov 2023 — 2024-2023=1 — match (month doesn\'t matter)',
  compareEducationYear(2024, 2021, 2023),
  { status: "match" }
);
check(
  '"2025" vs the same 2021-2023 range — 2025-2023=2 — discrepancy, minor',
  compareEducationYear(2025, 2021, 2023),
  { status: "discrepancy", severity: "minor" }
);
check(
  "3 years outside range — material",
  compareEducationYear(2026, 2021, 2023),
  { status: "discrepancy", severity: "material" }
);
check(
  "resumeYear exactly at startYear — match",
  compareEducationYear(2021, 2021, 2023),
  { status: "match" }
);
check(
  "resumeYear one year before startYear — match (in {-1,0,1} via startYear diff)",
  compareEducationYear(2020, 2021, 2023),
  { status: "match" }
);
check(
  "only crossRefEndYear known, resumeYear matches it — match",
  compareEducationYear(2023, null, 2023),
  { status: "match" }
);
check(
  "only crossRefStartYear known, 4 years off — material",
  compareEducationYear(2025, 2021, null),
  { status: "discrepancy", severity: "material" }
);
check(
  "resumeYear null — cannot_verify, not a crash",
  compareEducationYear(null, 2021, 2023),
  { status: "cannot_verify" }
);
check(
  "cross-reference shows no education record at all — cannot_verify",
  compareEducationYear(2023, null, null),
  { status: "cannot_verify" }
);
check(
  "exactly 2 years outside on the far side — still minor, not material",
  compareEducationYear(2018, 2020, 2020),
  { status: "discrepancy", severity: "minor" }
);

console.log(failures === 0 ? `\nAll checks PASS` : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
