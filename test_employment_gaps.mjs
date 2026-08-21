// Plain-Node verification of lib/detectEmploymentGaps.ts's pure logic —
// reimplemented inline here (same convention as test_trajectory_match.mjs)
// since this sandbox has no tsx/ts-node runtime available. Logic ported 1:1,
// only type annotations stripped.
// Run: node test_employment_gaps.mjs

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

const DEFAULT_TOLERANCE_MONTHS = 2;

function detectEmploymentGaps(entries, referenceNow, toleranceMonths = DEFAULT_TOLERANCE_MONTHS) {
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
    if (gapMonths > toleranceMonths) {
      gaps.push({ index: i, gapMonths });
    }
  }

  return { sortedEntries, gaps };
}

let pass = 0, total = 0;
function check(name, cond) {
  total++;
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else console.log(`FAIL: ${name}`);
}

const NOW = new Date("2026-08-20");

function entry(company, start, end) {
  return { company, title: "Role", employmentType: "full-time", startDate: start, endDate: end };
}

// Back-to-back roles, no gap
{
  const entries = [entry("A", "2018-01", "2020-01"), entry("B", "2020-02", "2022-01")];
  const { gaps } = detectEmploymentGaps(entries, NOW);
  check("back-to-back roles (1-month handoff): no gap", gaps.length === 0);
}

// ~2-month rounding tolerance — not flagged
{
  const entries = [entry("A", "2018-01", "2020-01"), entry("B", "2020-03", "2022-01")];
  const { gaps } = detectEmploymentGaps(entries, NOW);
  check("2-month gap: within tolerance, not flagged", gaps.length === 0);
}

// Real gap — 6 months
{
  const entries = [entry("A", "2018-01", "2020-01"), entry("B", "2020-07", "2022-01")];
  const { gaps } = detectEmploymentGaps(entries, NOW);
  check("6-month gap: flagged", gaps.length === 1);
  check("6-month gap: correct gapMonths", gaps[0]?.gapMonths === 6);
  check("6-month gap: correct index (between sorted 0 and 1)", gaps[0]?.index === 0);
}

// Entries given in reverse-chronological order (as scoreCandidate.ts always
// produces) — must still sort and detect correctly.
{
  const entries = [entry("B", "2020-07", "2022-01"), entry("A", "2018-01", "2020-01")];
  const { sortedEntries, gaps } = detectEmploymentGaps(entries, NOW);
  check("reverse-chronological input: sorted oldest-first", sortedEntries[0].company === "A" && sortedEntries[1].company === "B");
  check("reverse-chronological input: gap still detected", gaps.length === 1);
}

// Multiple gaps across 3 roles
{
  const entries = [
    entry("A", "2015-01", "2016-01"),
    entry("B", "2018-01", "2019-01"), // ~2yr gap after A
    entry("C", "2019-02", "present"), // no gap after B
  ];
  const { gaps } = detectEmploymentGaps(entries, NOW);
  check("multi-role: exactly one gap found (A→B)", gaps.length === 1 && gaps[0].index === 0);
}

// Unparseable date on one side — excluded from comparison, not treated as an infinite gap
{
  const entries = [entry("A", "garbled", "2020-01"), entry("B", "2020-02", "2022-01")];
  const { gaps } = detectEmploymentGaps(entries, NOW);
  check("unparseable start date: no fabricated gap", gaps.length === 0);
}

// "present" resolves against referenceNow
{
  const entries = [entry("A", "2018-01", "2020-01"), entry("B", "2020-02", "present")];
  const { gaps } = detectEmploymentGaps(entries, NOW);
  check("'present' end date: no gap, resolves cleanly", gaps.length === 0);
}

// Single entry — nothing to compare, no crash
{
  const entries = [entry("A", "2018-01", "2020-01")];
  const { sortedEntries, gaps } = detectEmploymentGaps(entries, NOW);
  check("single entry: no gaps, no crash", gaps.length === 0 && sortedEntries.length === 1);
}

// Empty array — no crash
{
  const { sortedEntries, gaps } = detectEmploymentGaps([], NOW);
  check("empty array: no crash", gaps.length === 0 && sortedEntries.length === 0);
}

// Custom tolerance respected
{
  const entries = [entry("A", "2018-01", "2020-01"), entry("B", "2020-05", "2022-01")];
  const { gaps: gapsDefault } = detectEmploymentGaps(entries, NOW);
  const { gaps: gapsLoose } = detectEmploymentGaps(entries, NOW, 6);
  check("3-month gap flagged at default (2mo) tolerance", gapsDefault.length === 1);
  check("3-month gap NOT flagged at looser (6mo) tolerance", gapsLoose.length === 0);
}

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
