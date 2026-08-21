// Plain-Node verification of computeChecklistScoreDelta's logic (mirrors it
// directly, since the real function imports the Anthropic client — this
// checks the pure math independent of that). Run: node test_checklist_delta.mjs
//
// 2026-08-17 update: the checklist is now single-list/additive-only (Vlad's
// direct feedback — a "decrease" item scoring a negative delta was
// confusing, and the checklist should never subtract; only the credibility
// check does). computeChecklistScoreDelta ignores `category` entirely now —
// these tests specifically confirm a legacy "decrease"-category result
// (from a checklist generated before this change) still ADDS when it fires,
// not subtracts, since no data migration was run to fix stored category values.

function computeChecklistScoreDelta(results) {
  let delta = 0;
  for (const result of results) {
    if (!result.fired) continue;
    delta += result.points;
  }
  return delta;
}

const cases = [
  { name: "nothing fired", results: [
    { fired: false, category: "decrease", points: 10 },
    { fired: false, category: "add", points: 5 },
  ], expect: 0 },
  { name: "one add fires", results: [
    { fired: true, category: "add", points: 6 },
  ], expect: 6 },
  { name: "mixed fired/unfired, all additive", results: [
    { fired: true, category: "add", points: 15 },
    { fired: false, category: "add", points: 8 },
    { fired: true, category: "add", points: 4 },
    { fired: true, category: "add", points: 3 },
  ], expect: 15 + 4 + 3 },
  { name: "empty results", results: [], expect: 0 },
  {
    name: "legacy 'decrease'-category result still ADDS on fire, not subtracts (no data migration needed)",
    results: [{ fired: true, category: "decrease", points: 12 }],
    expect: 12,
  },
  {
    name: "mix of legacy decrease and current add categories, both additive",
    results: [
      { fired: true, category: "decrease", points: 10 },
      { fired: true, category: "add", points: 5 },
      { fired: false, category: "decrease", points: 20 },
    ],
    expect: 15,
  },
];

let failures = 0;
for (const c of cases) {
  const got = computeChecklistScoreDelta(c.results);
  if (got !== c.expect) {
    failures++;
    console.error(`FAIL: ${c.name} — expected ${c.expect}, got ${got}`);
  } else {
    console.log(`PASS: ${c.name} (${got})`);
  }
}

console.log(failures === 0 ? `\nAll ${cases.length} PASS` : `\n${failures}/${cases.length} FAILED`);

// ── computeChecklistPercentageScore ─────────────────────────────────────────
// Roadmap: checklist-only scoring, 2026-08-17 (Vlad: "I though that I want
// to have only the checklist"). Score = fired points ÷ total possible
// points × 100, so a candidate can max out a short checklist as easily as a
// long one. Returns null (not 0) when there's nothing to compute a
// percentage from — the caller (lib/screenings.ts) falls back to the AI's
// own score in that case rather than showing a nonsensical 0.

function computeChecklistPercentageScore(results) {
  const totalPossiblePoints = results.reduce((sum, r) => sum + r.points, 0);
  if (totalPossiblePoints <= 0) return null;
  const firedPoints = results.filter((r) => r.fired).reduce((sum, r) => sum + r.points, 0);
  return Math.round((firedPoints / totalPossiblePoints) * 100);
}

const percentageCases = [
  { name: "everything fires — 100%", results: [
    { fired: true, points: 10 }, { fired: true, points: 5 }, { fired: true, points: 5 },
  ], expect: 100 },
  { name: "nothing fires — 0%", results: [
    { fired: false, points: 10 }, { fired: false, points: 5 },
  ], expect: 0 },
  { name: "half the points fire — 50%", results: [
    { fired: true, points: 10 }, { fired: false, points: 10 },
  ], expect: 50 },
  { name: "short checklist, everything fires — still 100%, not penalized for having fewer items", results: [
    { fired: true, points: 8 },
  ], expect: 100 },
  { name: "rounds to nearest integer", results: [
    { fired: true, points: 1 }, { fired: false, points: 2 },
  ], expect: 33 }, // 1/3 = 33.33... -> 33
  { name: "empty results — null, nothing to compute a percentage from", results: [], expect: null },
  { name: "all-zero-point items — null, not a divide-by-zero 0", results: [
    { fired: true, points: 0 }, { fired: false, points: 0 },
  ], expect: null },
  { name: "uneven weighting still resolves correctly", results: [
    { fired: true, points: 15 }, { fired: true, points: 3 }, { fired: false, points: 12 },
  ], expect: 60 }, // 18/30
];

let percentageFailures = 0;
for (const c of percentageCases) {
  const got = computeChecklistPercentageScore(c.results);
  if (got !== c.expect) {
    percentageFailures++;
    console.error(`FAIL: ${c.name} — expected ${c.expect}, got ${got}`);
  } else {
    console.log(`PASS: ${c.name} (${got})`);
  }
}

console.log(percentageFailures === 0 ? `\nAll ${percentageCases.length} PASS` : `\n${percentageFailures}/${percentageCases.length} FAILED`);
process.exit(failures === 0 && percentageFailures === 0 ? 0 : 1);
