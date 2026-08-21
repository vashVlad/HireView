// Plain-Node verification of matchCandidateToChecklist's tokenize/score
// logic (mirrors lib/matchArchiveFitToChecklist.ts directly, since that file
// imports lib/types.ts's type-only export — this checks the pure matching
// behavior against realistic example phrasing). Run: node test_archive_fit_checklist_match.mjs

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "had",
  "was", "were", "are", "not", "but", "you", "your", "their", "they", "them",
  "who", "what", "when", "where", "how", "into", "over", "under", "about",
  "years", "year", "experience", "experienced", "using", "used", "use",
]);

function tokenize(text) {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2 && !STOP_WORDS.has(t))
  );
}
const COVERAGE_THRESHOLD = 0.5;
const NEGATION_RE = /\b(no|not|n't|lack|lacks|lacking|missing|without|none|never|absent|absence)\b/i;
function isNegatedLabel(label) {
  return NEGATION_RE.test(label);
}
function phraseMatchScore(checklistLabel, candidatePhrase) {
  const itemTokens = tokenize(checklistLabel);
  if (itemTokens.size === 0) return 0;
  const phraseTokens = tokenize(candidatePhrase);
  let shared = 0;
  for (const t of itemTokens) if (phraseTokens.has(t)) shared++;
  return shared / itemTokens.size;
}
function matchCandidateToChecklist(strengths, concerns, checklistItems) {
  const candidatePhrases = [...(strengths ?? []), ...(concerns ?? [])].filter((p) => p && p.trim().length > 0);
  if (candidatePhrases.length === 0 || checklistItems.length === 0) return [];
  return checklistItems.filter(
    (item) =>
      !isNegatedLabel(item.label) &&
      candidatePhrases.some((phrase) => phraseMatchScore(item.label, phrase) >= COVERAGE_THRESHOLD)
  );
}

const checklist = [
  { id: "1", category: "decrease", label: "AWS Solutions Architect certification", points: 10 },
  { id: "2", category: "add", label: "Led a cross-functional team of 5+", points: 5 },
  { id: "3", category: "decrease", label: "FHIR interoperability experience", points: 12 },
  { id: "4", category: "add", label: "Owned a production on-call rotation", points: 6 },
  { id: "5", category: "decrease", label: "5+ years backend engineering", points: 10 },
];

const cases = [
  {
    name: "real match — AWS cert, close phrasing",
    strengths: ["AWS: Solutions Architect cert, EC2/S3 deployment"],
    concerns: [],
    expectMatchedIds: ["1"],
  },
  {
    name: "real match — FHIR, different wording",
    strengths: ["FHIR/HL7: implemented at Abridge with audit logging"],
    concerns: [],
    expectMatchedIds: ["3"],
  },
  {
    name: "real match — team leadership",
    strengths: ["Leadership: led a team of 6 engineers on migration"],
    concerns: [],
    expectMatchedIds: ["2"],
  },
  {
    name: "no false positive — unrelated strengths",
    strengths: ["Figma: shipped 3 design systems", "SQL: complex reporting queries"],
    concerns: ["No cloud experience evidenced"],
    expectMatchedIds: [],
  },
  {
    name: "concerns can match too, not just strengths",
    strengths: ["Python: data pipelines at scale"],
    concerns: ["On-call rotation: not clearly evidenced"],
    expectMatchedIds: ["4"],
  },
  {
    name: "empty candidate phrases — no matches, no crash",
    strengths: [],
    concerns: [],
    expectMatchedIds: [],
  },
  // Real bug found and fixed 2026-08-17, live-verified against realistic
  // labels: "decrease" items are inherently gap/absence checks, so their
  // natural phrasing is negation-based ("No X experience," "Lacks Y"). Pure
  // keyword-overlap has no polarity awareness — negation words are stop
  // words or too short to survive tokenize(), so only the content keywords
  // drove the score, meaning a candidate who strongly HAS the skill would
  // score a near-perfect match against a checklist item whose entire point
  // is that they DON'T have it. Confirmed reproducible against 3 realistic
  // pairs before the isNegatedLabel() guard was added.
  {
    name: "polarity false positive — candidate HAS container orchestration, item says they lack it",
    strengths: ["Container orchestration: extensive Kubernetes and Docker Swarm production experience"],
    concerns: [],
    checklist: [{ id: "neg1", category: "decrease", label: "No container orchestration experience", points: 6 }],
    expectMatchedIds: [],
  },
  {
    name: "polarity false positive — candidate HAS cloud experience, item says they lack it",
    strengths: ["Public cloud: 6 years AWS and GCP infrastructure experience"],
    concerns: [],
    checklist: [{ id: "neg2", category: "decrease", label: "Lacks public cloud experience", points: 5 }],
    expectMatchedIds: [],
  },
  {
    name: "regression check — same skill still matches when the label is NOT negated",
    strengths: ["Container orchestration: extensive Kubernetes and Docker Swarm production experience"],
    concerns: [],
    checklist: [{ id: "pos1", category: "decrease", label: "Container orchestration experience", points: 6 }],
    expectMatchedIds: ["pos1"],
  },
];

let failures = 0;
for (const c of cases) {
  const matched = matchCandidateToChecklist(c.strengths, c.concerns, c.checklist ?? checklist).map((i) => i.id).sort();
  const expected = [...c.expectMatchedIds].sort();
  const pass = JSON.stringify(matched) === JSON.stringify(expected);
  if (!pass) {
    failures++;
    console.error(`FAIL: ${c.name} — expected [${expected}], got [${matched}]`);
  } else {
    console.log(`PASS: ${c.name} — matched [${matched}]`);
  }
}

console.log(failures === 0 ? `\nAll ${cases.length} PASS` : `\n${failures}/${cases.length} FAILED`);
process.exit(failures === 0 ? 0 : 1);
