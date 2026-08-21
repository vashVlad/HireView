// Plain-Node verification of attributeChecklistPointsToRoles's logic (mirrors
// it directly, same convention as this project's other test_*.mjs files —
// the real function imports from lib/matchTrajectoryEntries.ts, this checks
// the pure math/matching independent of that). Run: node test_attribute_checklist_to_roles.mjs
//
// 2026-08-18 — roadmap 2.5.2 follow-up: TrajectoryGraph's new per-role score
// chart needs to know which role each fired checklist item's evidence came
// from. This function does the deterministic attribution; these tests cover
// the matching rules (loose company match, unmatched/general evidence,
// duplicate-company tie-break) independent of any AI call.

function normalizeCompanyForCompare(s) {
  return (s ?? "")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|llc|ltd|corp|corporation|co)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function companiesLooselyMatch(a, b) {
  const na = normalizeCompanyForCompare(a);
  const nb = normalizeCompanyForCompare(b);
  if (!na || !nb) return na === nb;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function attributeChecklistPointsToRoles(results, entries) {
  const points = entries.map(() => 0);
  for (const result of results) {
    if (!result.fired) continue;
    const source = result.evidenceSource?.trim();
    if (!source) continue;
    const matchIndex = entries.findIndex((entry) => companiesLooselyMatch(source, entry.company));
    if (matchIndex === -1) continue;
    points[matchIndex] += result.points;
  }
  return entries.map((entry, i) => ({ entry, points: points[i] }));
}

const entries = [
  { company: "Optum", title: "Support Engineer", employmentType: "full-time", startDate: "2026-04", endDate: "present" },
  { company: "LTIMindtree", title: "Big Data Engineer", employmentType: "full-time", startDate: "2022-04", endDate: "2023-04" },
];

const cases = [
  {
    name: "single fired item matches its role exactly",
    results: [{ fired: true, points: 12, evidenceSource: "Optum" }],
    expect: [12, 0],
  },
  {
    name: "unfired item contributes nothing even with a valid evidenceSource",
    results: [{ fired: false, points: 12, evidenceSource: "Optum" }],
    expect: [0, 0],
  },
  {
    name: "empty evidenceSource (general/skills evidence) contributes nothing",
    results: [{ fired: true, points: 10, evidenceSource: "" }],
    expect: [0, 0],
  },
  {
    name: "undefined evidenceSource contributes nothing",
    results: [{ fired: true, points: 10 }],
    expect: [0, 0],
  },
  {
    name: "evidenceSource matching no role contributes nothing",
    results: [{ fired: true, points: 10, evidenceSource: "Some Unrelated Startup" }],
    expect: [0, 0],
  },
  {
    name: "loose match — company suffix (Inc/LLC) stripped",
    results: [{ fired: true, points: 8, evidenceSource: "LTIMindtree LLC" }],
    expect: [0, 8],
  },
  {
    name: "multiple fired items on the same role sum correctly",
    results: [
      { fired: true, points: 12, evidenceSource: "Optum" },
      { fired: true, points: 9, evidenceSource: "Optum" },
    ],
    expect: [21, 0],
  },
  {
    name: "items spread across both roles attribute independently",
    results: [
      { fired: true, points: 12, evidenceSource: "Optum" },
      { fired: true, points: 15, evidenceSource: "LTIMindtree" },
      { fired: false, points: 99, evidenceSource: "Optum" },
    ],
    expect: [12, 15],
  },
  {
    name: "duplicate-company evidenceSource ties to the FIRST matching role",
    results: [{ fired: true, points: 5, evidenceSource: "optum" }],
    entries: [
      { company: "Optum", title: "Support Engineer", employmentType: "full-time", startDate: "2026-04", endDate: "present" },
      { company: "Optum", title: "Data Engineer", employmentType: "full-time", startDate: "2020-01", endDate: "2022-01" },
    ],
    expect: [5, 0],
  },
  {
    name: "empty entries array returns empty result",
    results: [{ fired: true, points: 5, evidenceSource: "Optum" }],
    entries: [],
    expect: [],
  },
];

let failures = 0;
for (const c of cases) {
  const testEntries = c.entries ?? entries;
  const got = attributeChecklistPointsToRoles(c.results, testEntries).map((r) => r.points);
  const expectStr = JSON.stringify(c.expect);
  const gotStr = JSON.stringify(got);
  if (gotStr !== expectStr) {
    failures++;
    console.error(`FAIL: ${c.name} — expected ${expectStr}, got ${gotStr}`);
  } else {
    console.log(`PASS: ${c.name} (${gotStr})`);
  }
}

console.log(failures === 0 ? `\nAll ${cases.length} PASS` : `\n${failures}/${cases.length} FAILED`);
process.exit(failures === 0 ? 0 : 1);
