// Plain-Node verification of components/TrajectoryGraph.tsx's
// computeTrajectoryValues (mirrors it directly, same convention as this
// repo's other test_*.mjs files — the real function lives in a "use client"
// component and depends on lib/detectEmploymentGaps.ts, reimplemented here
// as plain JS). Run: node test_trajectory_values.mjs
//
// Phase 2.6 Tier 4 (2026-08-20) — the core data-transform behind the
// redesigned TrajectoryGraph Y-axis: career trajectory/seniority
// (accumulated stepDirection), not checklist points, with a real employment
// gap forcing a visible dip regardless of what stepDirection said.

function parseYearMonth(date, referenceNow) {
  const trimmed = (date ?? "").trim().toLowerCase();
  if (trimmed === "present" || trimmed === "current") {
    return { year: referenceNow.getFullYear(), month: referenceNow.getMonth() + 1 };
  }
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (monthMatch) return { year: parseInt(monthMatch[1], 10), month: parseInt(monthMatch[2], 10) };
  const yearMatch = /^(\d{4})$/.exec(trimmed);
  if (yearMatch) return { year: parseInt(yearMatch[1], 10), month: null };
  return { year: NaN, month: null };
}

function toMonthRange(entry, referenceNow) {
  const start = parseYearMonth(entry.startDate, referenceNow);
  const end = parseYearMonth(entry.endDate, referenceNow);
  const startIdx = isNaN(start.year) ? -Infinity : start.year * 12 + (start.month ?? 1) - 1;
  const endIdx = isNaN(end.year) ? Infinity : end.year * 12 + (end.month ?? 12) - 1;
  return [startIdx, endIdx];
}

function detectEmploymentGaps(entries, referenceNow, toleranceMonths = 2) {
  const withRange = entries.map((entry) => ({ entry, range: toMonthRange(entry, referenceNow) }));
  withRange.sort((a, b) => {
    const aStart = isFinite(a.range[0]) ? a.range[0] : -Infinity;
    const bStart = isFinite(b.range[0]) ? b.range[0] : -Infinity;
    return aStart - bStart;
  });
  const sortedEntries = withRange.map((r) => r.entry);
  const gaps = [];
  for (let i = 0; i < withRange.length - 1; i++) {
    const prevEnd = withRange[i].range[1];
    const nextStart = withRange[i + 1].range[0];
    if (!isFinite(prevEnd) || !isFinite(nextStart)) continue;
    const gapMonths = nextStart - prevEnd;
    if (gapMonths > toleranceMonths) gaps.push({ index: i, gapMonths });
  }
  return { sortedEntries, gaps };
}

function computeTrajectoryValues(entries, referenceNow, checklistByRole) {
  const { sortedEntries, gaps } = detectEmploymentGaps(entries, referenceNow);
  const gapBeforeIndex = new Map(gaps.map((g) => [g.index + 1, g.gapMonths]));

  const values = [];
  let cumulative = 0;
  for (let i = 0; i < sortedEntries.length; i++) {
    const entry = sortedEntries[i];
    const gapMonths = gapBeforeIndex.get(i);
    const hasGapBefore = gapMonths !== undefined;
    let value;
    if (i === 0) {
      value = 0;
    } else {
      const delta = entry.stepDirection === "up" ? 1 : entry.stepDirection === "down" ? -1 : 0;
      value = cumulative + delta;
      if (hasGapBefore) value = Math.min(value, cumulative - 1);
    }
    cumulative = value;
    const checklist = checklistByRole?.find((c) => c.entry === entry);
    values.push({ entry, value, hasGapBefore, gapMonths, checklist });
  }
  return values;
}

let pass = 0, total = 0;
function check(name, cond) {
  total++;
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else console.log(`FAIL: ${name}`);
}

const NOW = new Date("2026-08-20");
function entry(company, start, end, stepDirection) {
  return { company, title: "Role", employmentType: "full-time", startDate: start, endDate: end, stepDirection };
}

// First entry always baseline 0, regardless of its own stepDirection value
{
  const values = computeTrajectoryValues([entry("A", "2018-01", "2020-01", "first")], NOW);
  check("single 'first' entry: value 0", values[0].value === 0);
}

// Straight accumulation: up, up, down
{
  const entries = [
    entry("A", "2015-01", "2017-01", "first"),
    entry("B", "2017-02", "2019-01", "up"),
    entry("C", "2019-02", "2021-01", "up"),
    entry("D", "2021-02", "present", "down"),
  ];
  const values = computeTrajectoryValues(entries, NOW);
  check("first: 0", values[0].value === 0);
  check("up: 0 -> 1", values[1].value === 1);
  check("up: 1 -> 2", values[2].value === 2);
  check("down: 2 -> 1", values[3].value === 1);
}

// Lateral and undefined stepDirection both contribute 0
{
  const entries = [
    entry("A", "2015-01", "2017-01", "first"),
    entry("B", "2017-02", "2019-01", "lateral"),
    entry("C", "2019-02", "present", undefined),
  ];
  const values = computeTrajectoryValues(entries, NOW);
  check("lateral: 0 -> 0", values[1].value === 0);
  check("undefined stepDirection degrades to lateral (0 -> 0)", values[2].value === 0);
}

// Gap forces a dip even when stepDirection says "up"
{
  const entries = [
    entry("A", "2015-01", "2016-01", "first"),
    entry("B", "2020-01", "2021-01", "up"), // 4-year gap before this role, but stepDirection says up
  ];
  const values = computeTrajectoryValues(entries, NOW);
  check("gap forces dip below previous value despite stepDirection: up", values[1].hasGapBefore === true && values[1].value < values[0].value);
}

// Gap does NOT override a genuine down (already lower than a forced dip would require)
{
  const entries = [
    entry("A", "2015-01", "2018-01", "first"),
    entry("B", "2019-01", "2021-01", "down"), // gapped AND down
  ];
  const values = computeTrajectoryValues(entries, NOW);
  check("gapped + down: still strictly below previous", values[1].value < values[0].value);
}

// No gap: stepDirection alone determines value, no forced dip
{
  const entries = [
    entry("A", "2015-01", "2017-01", "first"),
    entry("B", "2017-02", "present", "up"),
  ];
  const values = computeTrajectoryValues(entries, NOW);
  check("no gap: up moves value up normally, not dipped", values[1].hasGapBefore === false && values[1].value === 1);
}

// Reverse-chronological input (as scoreCandidate.ts always produces) still
// accumulates in true chronological order, not input order. Dates chosen
// with zero gap between roles so only the accumulation-order behavior is
// under test here (gap-forcing is covered by its own cases above).
{
  const entries = [
    entry("C", "2020-02", "present", "up"), // most recent, listed first
    entry("B", "2018-01", "2020-01", "up"),
    entry("A", "2015-01", "2017-12", "first"),
  ];
  const values = computeTrajectoryValues(entries, NOW);
  check("reverse-chronological input: sorted oldest-first (A, B, C)", values[0].entry.company === "A" && values[1].entry.company === "B" && values[2].entry.company === "C");
  check("reverse-chronological input: accumulation still 0, 1, 2", values[0].value === 0 && values[1].value === 1 && values[2].value === 2);
}

// checklist lookup by reference equality
{
  const a = entry("A", "2015-01", "2017-01", "first");
  const b = entry("B", "2017-02", "present", "up");
  const checklistByRole = [{ entry: b, points: 5, firedItems: [{ itemId: "1", fired: true, reasoning: "x", label: "FHIR", category: "add", points: 5 }] }];
  const values = computeTrajectoryValues([a, b], NOW, checklistByRole);
  check("checklist detail attaches to the correct role by reference", values[1].checklist?.firedItems.length === 1 && values[0].checklist === undefined);
}

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
