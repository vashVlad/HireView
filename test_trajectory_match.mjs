// Plain-Node verification of lib/matchTrajectoryEntries.ts's pure pairing/diff
// logic — reimplemented inline here (same convention as test_embeddings_pure.mjs)
// since this sandbox has no tsx/ts-node runtime available. Logic ported 1:1,
// only type annotations stripped.
// Run: node test_trajectory_match.mjs

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

function rangesOverlap(a, b) {
  return a[0] <= b[1] && b[0] <= a[1];
}

function overlapMonths(a, b) {
  if (!rangesOverlap(a, b)) return 0;
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return isFinite(hi - lo) ? hi - lo : 0;
}

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

function titlesLooselyMatch(a, b) {
  return (a ?? "").toLowerCase().trim() === (b ?? "").toLowerCase().trim();
}

function datesLooselyMatch(a, b, referenceNow) {
  const [aStart, aEnd] = toMonthRange(a, referenceNow);
  const [bStart, bEnd] = toMonthRange(b, referenceNow);
  return Math.abs(aStart - bStart) <= 2 && Math.abs(aEnd - bEnd) <= 2;
}

function pairScore(resumeEntry, crossRefEntry, referenceNow) {
  let score = 0;
  if (companiesLooselyMatch(resumeEntry.company, crossRefEntry.company)) score += 4;
  if (titlesLooselyMatch(resumeEntry.title, crossRefEntry.title)) score += 2;
  const overlap = overlapMonths(toMonthRange(resumeEntry, referenceNow), toMonthRange(crossRefEntry, referenceNow));
  if (overlap > 0) score += Math.min(1, overlap / 12);
  return score;
}

function matchTrajectoryEntries(resumeEntries, crossRefEntries, referenceNow = new Date()) {
  const rows = [];
  const usedCrossRefIndices = new Set();

  for (const resumeEntry of resumeEntries) {
    let bestIndex = -1;
    let bestScore = 0;
    crossRefEntries.forEach((crossRefEntry, idx) => {
      if (usedCrossRefIndices.has(idx)) return;
      const score = pairScore(resumeEntry, crossRefEntry, referenceNow);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = idx;
      }
    });

    if (bestIndex === -1) continue;

    usedCrossRefIndices.add(bestIndex);
    const crossRefEntry = crossRefEntries[bestIndex];
    const fieldDiffs = {
      company: !companiesLooselyMatch(resumeEntry.company, crossRefEntry.company),
      title: !titlesLooselyMatch(resumeEntry.title, crossRefEntry.title),
      dates: !datesLooselyMatch(resumeEntry, crossRefEntry, referenceNow),
    };
    const hasAnyDiff = fieldDiffs.company || fieldDiffs.title || fieldDiffs.dates;
    rows.push({
      resumeEntry,
      crossRefEntry,
      kind: "paired",
      fieldDiffs,
      status: hasAnyDiff ? "discrepancy" : "match",
    });
  }

  crossRefEntries.forEach((crossRefEntry, idx) => {
    if (usedCrossRefIndices.has(idx)) return;
    rows.push({ crossRefEntry, kind: "undisclosed", status: "discrepancy" });
  });

  return rows;
}

function rowsNeedingJudgment(rows) {
  return rows.filter((r) => r.status !== "match");
}

// ── Tests ────────────────────────────────────────────────────────────────

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

const NOW = new Date("2026-08-17T00:00:00Z");

// 1. Identical entries — zero diffs, confident match, no AI needed
{
  const resume = [{ company: "Google", title: "Software Engineer", employmentType: "full-time", startDate: "2019-06", endDate: "2022-01" }];
  const crossRef = [{ company: "Google", title: "Software Engineer", employmentType: "full-time", startDate: "2019-06", endDate: "2022-01" }];
  const rows = matchTrajectoryEntries(resume, crossRef, NOW);
  check("identical entries: one paired row, status match", rows.map((r) => r.status), ["match"]);
  check("identical entries: excluded from rowsNeedingJudgment", rowsNeedingJudgment(rows).length, 0);
}

// 2. Date fabrication — same company/title, non-overlapping dates. This is
// the case date-only pairing would miss entirely; identity-first pairing
// must still catch it as a flagged pair, not two silent orphans.
{
  const resume = [{ company: "Acme Corp", title: "Product Manager", employmentType: "full-time", startDate: "2019-01", endDate: "2022-01" }];
  const crossRef = [{ company: "Acme Corp", title: "Product Manager", employmentType: "full-time", startDate: "2015-01", endDate: "2018-01" }];
  const rows = matchTrajectoryEntries(resume, crossRef, NOW);
  check("date fabrication: still paired via identity, not dropped as orphans", rows.length, 1);
  check("date fabrication: dates flagged, company/title not", rows[0].fieldDiffs, { company: false, title: false, dates: true });
  check("date fabrication: routed to judgment", rowsNeedingJudgment(rows).length, 1);
}

// 3. Staffing-agency company variant, same title/dates — pairs, only company flagged (AI decides minor vs material)
{
  const resume = [{ company: "MegaClient Inc", title: "Consultant", employmentType: "contract", startDate: "2021-03", endDate: "2023-06" }];
  const crossRef = [{ company: "StaffCo Solutions", title: "Consultant", employmentType: "contract", startDate: "2021-03", endDate: "2023-06" }];
  const rows = matchTrajectoryEntries(resume, crossRef, NOW);
  check("staffing variant: paired, only company differs", rows[0].fieldDiffs, { company: true, title: false, dates: false });
}

// 4. ~2-month date rounding tolerance — should NOT flag as a diff
{
  const resume = [{ company: "Meridian Health", title: "Data Analyst", employmentType: "full-time", startDate: "2020-01", endDate: "2023-03" }];
  const crossRef = [{ company: "Meridian Health", title: "Data Analyst", employmentType: "full-time", startDate: "2020-02", endDate: "2023-01" }];
  const rows = matchTrajectoryEntries(resume, crossRef, NOW);
  check("~2-month rounding: dates not flagged", rows[0].fieldDiffs.dates, false);
  check("~2-month rounding: confident match, no judgment needed", rows[0].status, "match");
}

// 5. Beyond tolerance (3+ months) — should flag
{
  const resume = [{ company: "Meridian Health", title: "Data Analyst", employmentType: "full-time", startDate: "2020-01", endDate: "2023-06" }];
  const crossRef = [{ company: "Meridian Health", title: "Data Analyst", employmentType: "full-time", startDate: "2020-01", endDate: "2023-01" }];
  const rows = matchTrajectoryEntries(resume, crossRef, NOW);
  check("5-month gap beyond tolerance: dates flagged", rows[0].fieldDiffs.dates, true);
}

// 6. Undisclosed employment — cross-ref-only entry with no resume counterpart
{
  const resume = [{ company: "Acme Corp", title: "Engineer", employmentType: "full-time", startDate: "2020-01", endDate: "present" }];
  const crossRef = [
    { company: "Acme Corp", title: "Engineer", employmentType: "full-time", startDate: "2020-01", endDate: "present" },
    { company: "SecretGig LLC", title: "Freelancer", employmentType: "contract", startDate: "2020-06", endDate: "2020-12" },
  ];
  const rows = matchTrajectoryEntries(resume, crossRef, NOW);
  const undisclosed = rows.filter((r) => r.kind === "undisclosed");
  check("undisclosed: exactly one surfaced", undisclosed.length, 1);
  check("undisclosed: correct entry surfaced", undisclosed[0].crossRefEntry.company, "SecretGig LLC");
  check("undisclosed: no resumeEntry", undisclosed[0].resumeEntry, undefined);
}

// 7. Resume-only entry (older role LinkedIn doesn't show) — silently dropped, not a row
{
  const resume = [
    { company: "Acme Corp", title: "Engineer", employmentType: "full-time", startDate: "2020-01", endDate: "present" },
    { company: "OldJob LLC", title: "Intern", employmentType: "full-time", startDate: "2010-01", endDate: "2010-06" },
  ];
  const crossRef = [{ company: "Acme Corp", title: "Engineer", employmentType: "full-time", startDate: "2020-01", endDate: "present" }];
  const rows = matchTrajectoryEntries(resume, crossRef, NOW);
  check("resume-only entry: not surfaced as its own row", rows.length, 1);
  check("resume-only entry: the one row present is the real pair", rows[0].kind, "paired");
}

// 8. "present" resolves against referenceNow, not treated as unparseable
{
  const resume = [{ company: "Acme Corp", title: "Engineer", employmentType: "full-time", startDate: "2023-01", endDate: "present" }];
  const crossRef = [{ company: "Acme Corp", title: "Engineer", employmentType: "full-time", startDate: "2023-01", endDate: "2026-08" }];
  const rows = matchTrajectoryEntries(resume, crossRef, NOW);
  check('"present" vs an end date matching referenceNow: dates match', rows[0].fieldDiffs.dates, false);
}

// 9. Company containment (e.g. "GCB" vs "GCB Services") matches loosely
{
  check("company containment matches", companiesLooselyMatch("GCB", "GCB Services"), true);
  check("legal-entity suffix stripped", companiesLooselyMatch("Acme Corp", "Acme Corporation"), true);
  check("genuinely different companies do not match", companiesLooselyMatch("Google", "Amazon"), false);
}

// 10. Multiple resume roles pair against the correct cross-ref counterpart, not just first-available
{
  const resume = [
    { company: "Google", title: "Engineer", employmentType: "full-time", startDate: "2022-01", endDate: "present" },
    { company: "Meta", title: "Engineer", employmentType: "full-time", startDate: "2019-01", endDate: "2021-12" },
  ];
  const crossRef = [
    { company: "Meta", title: "Engineer", employmentType: "full-time", startDate: "2019-01", endDate: "2021-12" },
    { company: "Google", title: "Engineer", employmentType: "full-time", startDate: "2022-01", endDate: "present" },
  ];
  const rows = matchTrajectoryEntries(resume, crossRef, NOW);
  check("out-of-order entries still pair correctly", rows.every((r) => r.resumeEntry.company === r.crossRefEntry.company), true);
  check("out-of-order entries: both confident matches", rows.map((r) => r.status).sort(), ["match", "match"]);
}

console.log(failures === 0 ? `\nAll checks PASS` : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
