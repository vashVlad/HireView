// Plain-Node verification of stripLegalSuffix + computeTargetCompanyBoost's
// matching logic (mirrors it directly — the real module has no external
// imports, but keeping this repo's established plain-mirror convention for
// consistency with the other test_*.mjs files). Run:
// node test_target_company_boost.mjs
//
// 2026-08-19, Phase 2.6 — alias-awareness for target-company matching
// (Vlad's ask, "loose match only"). Confirms the specific gap this was
// built for: a target entered with a fuller legal name ("Google LLC")
// matching a resume that just says the bare name ("Google").

const TARGET_COMPANY_BOOST_POINTS = 5;

function stripLegalSuffix(name) {
  const lower = name.toLowerCase().replace(/[.,]/g, "").trim();
  const stripped = lower.replace(/\s+(inc|llc|ltd|corp|corporation|co|company|group|holdings|plc)$/i, "").trim();
  return stripped.length >= 2 ? stripped : lower;
}

function computeTargetCompanyBoost(resumeText, targetCompanies) {
  const candidates = (targetCompanies ?? []).map((c) => c.trim()).filter((c) => c.length >= 2);
  if (candidates.length === 0 || !resumeText) return { matched: false, matchedCompanies: [], bonus: 0 };

  const lowerResume = resumeText.toLowerCase();
  const seen = new Set();
  const matchedCompanies = [];
  for (const company of candidates) {
    const key = stripLegalSuffix(company);
    if (seen.has(key)) continue;
    if (lowerResume.includes(key)) {
      seen.add(key);
      matchedCompanies.push(company);
    }
  }
  return {
    matched: matchedCompanies.length > 0,
    matchedCompanies,
    bonus: matchedCompanies.length > 0 ? TARGET_COMPANY_BOOST_POINTS : 0,
  };
}

let pass = 0, total = 0;
function check(name, cond) {
  total++;
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else console.log(`FAIL: ${name}`);
}

// stripLegalSuffix cases
check("strips LLC", stripLegalSuffix("Google LLC") === "google");
check("strips Inc with period", stripLegalSuffix("Acme Inc.") === "acme");
check("strips Corp", stripLegalSuffix("Initech Corp") === "initech");
check("strips Corporation", stripLegalSuffix("Umbrella Corporation") === "umbrella");
check("no suffix, unchanged (lowercased)", stripLegalSuffix("Netflix") === "netflix");
check("degenerate case falls back — 'Co' alone stays 'co'", stripLegalSuffix("Co") === "co");
check("multi-word name with suffix", stripLegalSuffix("Data Systems Group") === "data systems");

// computeTargetCompanyBoost — the actual gap this was built for
check(
  "target 'Google LLC' matches resume mentioning bare 'Google' (the real gap fixed)",
  computeTargetCompanyBoost("Worked at Google as a software engineer.", ["Google LLC"]).matched === true
);
check(
  "target 'Acme Inc.' matches resume mentioning 'Acme' only",
  computeTargetCompanyBoost("5 years at Acme building infra.", ["Acme Inc."]).matched === true
);
check(
  "reverse direction still works unchanged: short target matches fuller resume mention",
  computeTargetCompanyBoost("Senior Engineer, Google LLC, 2019-2023.", ["Google"]).matched === true
);
check(
  "no match when company genuinely absent",
  computeTargetCompanyBoost("Worked at Initech.", ["Google LLC"]).matched === false
);
check(
  "dedup on stripped key — same company listed two ways only counts once",
  computeTargetCompanyBoost("I worked at Google for years.", ["Google", "Google LLC"]).matchedCompanies.length === 1
);
check(
  "bonus is flat regardless of how many companies matched",
  computeTargetCompanyBoost("Google and Acme Inc. both on my resume.", ["Google", "Acme Inc."]).bonus === TARGET_COMPANY_BOOST_POINTS
);
check(
  "empty target list / empty resume both resolve to no match",
  computeTargetCompanyBoost("", ["Google"]).matched === false &&
  computeTargetCompanyBoost("Google", []).matched === false
);

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
