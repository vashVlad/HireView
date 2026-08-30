// Plain-Node verification of buildExperienceHighlights (lib/experienceHighlights.ts)
// — mirrors its logic directly, same established plain-mirror convention as
// the other test_*.mjs files. Run: node test_experience_highlights.mjs

function parseYear(d) {
  if (d === "present") return new Date().getFullYear();
  const y = parseInt(d.slice(0, 4), 10);
  return Number.isNaN(y) ? null : y;
}
function yearsSpan(entries) {
  const years = entries.flatMap((e) => [parseYear(e.startDate), parseYear(e.endDate)]).filter((y) => y !== null);
  if (years.length === 0) return null;
  const span = Math.max(...years) - Math.min(...years);
  return span >= 0 ? span : null;
}
function directionLabel(entries) {
  if (entries.length < 2) return null;
  const ups = entries.filter((e) => e.stepDirection === "up").length;
  const downs = entries.filter((e) => e.stepDirection === "down").length;
  const direction = downs > ups ? "declining trajectory" : ups > 0 ? "steady upward trajectory" : "lateral moves";
  const span = yearsSpan(entries);
  return span !== null && span > 0 ? `${span} yrs, ${direction}` : direction;
}
function formatEndDate(endDate) {
  return endDate === "present" ? "now" : endDate;
}
function buildExperienceHighlights(result) {
  const highlights = [];
  const entries = result.trajectoryEntries ?? [];
  const direction = directionLabel(entries);
  if (direction) highlights.push({ tone: "trajectory", label: direction });
  for (const entry of entries.slice(0, 2)) {
    highlights.push({ tone: "role", label: `${entry.title}, ${entry.company}`, detail: `${entry.startDate}–${formatEndDate(entry.endDate)}` });
  }
  const topStrength = result.strengths?.[0];
  if (topStrength) highlights.push({ tone: "strength", label: topStrength });
  return highlights.slice(0, 4);
}

let failures = 0;
function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}
function assertTrue(cond, label) {
  if (!cond) { failures++; console.error(`FAIL: ${label}`); } else { console.log(`PASS: ${label}`); }
}

// --- full data: 2 up-steps + strengths ---
const full = buildExperienceHighlights({
  trajectoryEntries: [
    { company: "Acme Corp", title: "Director of Ops", employmentType: "full-time", startDate: "2023-01", endDate: "present", stepDirection: "up" },
    { company: "Beacon Health", title: "Sr. Analyst", employmentType: "full-time", startDate: "2020-01", endDate: "2023-01", stepDirection: "up" },
    { company: "Beacon Health", title: "Analyst", employmentType: "full-time", startDate: "2018-01", endDate: "2020-01", stepDirection: "first" },
  ],
  strengths: ["Direct experience with the exact reporting stack this role owns", "Second strength"],
});
assertEqual(full.length, 4, "full data -> capped at 4 highlights");
assertEqual(full[0].tone, "trajectory", "first highlight is the trajectory-direction bullet");
assertTrue(full[0].label.includes("steady upward trajectory"), "2 up-steps -> steady upward trajectory label");
assertEqual(full[1].label, "Director of Ops, Acme Corp", "second highlight is the most recent role (index 0 of trajectoryEntries)");
assertEqual(full[1].detail, "2023-01–now", '"present" endDate renders as "now" in detail');
assertEqual(full[2].label, "Sr. Analyst, Beacon Health", "third highlight is the second-most-recent role");
assertEqual(full[3].label, "Direct experience with the exact reporting stack this role owns", "fourth highlight is strengths[0] verbatim");

// --- declining trajectory ---
const declining = buildExperienceHighlights({
  trajectoryEntries: [
    { company: "B", title: "Analyst", employmentType: "full-time", startDate: "2023-01", endDate: "present", stepDirection: "down" },
    { company: "A", title: "Manager", employmentType: "full-time", startDate: "2020-01", endDate: "2023-01", stepDirection: "first" },
  ],
});
assertTrue(declining[0].label.includes("declining trajectory"), "more down-steps than up -> declining trajectory label");

// --- single entry: no direction bullet, no crash on "first" ---
const single = buildExperienceHighlights({
  trajectoryEntries: [{ company: "Only Co", title: "Engineer", employmentType: "full-time", startDate: "2022-01", endDate: "present", stepDirection: "first" }],
});
assertEqual(single.length, 1, "single trajectory entry -> no direction bullet, just the 1 role bullet");
assertEqual(single[0].tone, "role", "single entry's only highlight is a role bullet, not a trajectory bullet");

// --- no trajectoryEntries, strengths present ---
const strengthsOnly = buildExperienceHighlights({ strengths: ["Only strength"] });
assertEqual(strengthsOnly, [{ tone: "strength", label: "Only strength" }], "no trajectoryEntries -> just the 1 strength bullet");

// --- nothing at all ---
assertEqual(buildExperienceHighlights({}), [], "no trajectoryEntries, no strengths -> empty array, no crash");
assertEqual(buildExperienceHighlights({ trajectoryEntries: [], strengths: [] }), [], "empty arrays (not undefined) -> empty array");

console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
