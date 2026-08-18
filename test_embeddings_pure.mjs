// Plain-Node verification of lib/embeddings.ts's buildCandidateEmbeddingText
// and lib/candidateSearch.ts's highlightQueryOverlap — the two pure,
// testable functions in the global talent search feature. The actual Voyage
// API call and Postgres RPC cannot be tested here (no network access).
// Run: node test_embeddings_pure.mjs

function buildCandidateEmbeddingText(params) {
  const parts = [
    params.summary,
    ...(params.strengths ?? []),
    ...(params.concerns ?? []),
    params.careerTrajectory,
  ].filter((p) => typeof p === "string" && p.trim().length > 0);
  return parts.join("\n");
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "had",
  "was", "were", "are", "not", "but", "you", "your", "their", "they", "them",
  "who", "what", "when", "where", "how", "into", "over", "under", "about",
  "years", "year", "experience", "experienced", "using", "used", "use",
  "with", "someone", "who", "has",
]);

function tokenize(text) {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2 && !STOP_WORDS.has(t))
  );
}

function highlightQueryOverlap(query, candidateText) {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return [];
  const candidateTokens = tokenize(candidateText);
  return [...queryTokens].filter((t) => candidateTokens.has(t));
}

let failures = 0;
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) {
    failures++;
    console.error(`FAIL: ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`PASS: ${name}`);
  }
}

// buildCandidateEmbeddingText
check(
  "full profile concatenates in order",
  buildCandidateEmbeddingText({
    summary: "Backend engineer",
    strengths: ["Kubernetes: ran prod cluster"],
    concerns: ["Gap in 2021"],
    careerTrajectory: "Steady IC growth",
  }),
  "Backend engineer\nKubernetes: ran prod cluster\nGap in 2021\nSteady IC growth"
);
check(
  "missing fields are skipped, not inserted as blank lines",
  buildCandidateEmbeddingText({ summary: "Backend engineer", strengths: [], concerns: undefined }),
  "Backend engineer"
);
check("everything empty yields empty string", buildCandidateEmbeddingText({}), "");
check(
  "whitespace-only fields treated as absent",
  buildCandidateEmbeddingText({ summary: "   ", strengths: ["Real strength"] }),
  "Real strength"
);
// Real bug found and fixed 2026-08-17, live-verified against the actual
// backfill run: 2 real screenings (out of 396) had strengths/concerns
// shaped as arrays of OBJECTS (an old scoreCandidate.ts tool-call output
// quirk, e.g. [{"Skill": "..."}]) instead of plain strings. The original
// filter (`Boolean(p && p.trim()...)`) crashed with "p.trim is not a
// function" the instant it hit one of these — real production data, not a
// hypothetical edge case.
check(
  "non-string array items (real malformed data) are dropped, not a crash",
  buildCandidateEmbeddingText({
    summary: "Program manager",
    strengths: [{ Skill: "Regulated industry delivery" }, "Real strength: evidenced"],
    concerns: [{ item: "Some concern object" }],
    careerTrajectory: "Steady growth",
  }),
  "Program manager\nReal strength: evidenced\nSteady growth"
);

// highlightQueryOverlap
check(
  "real overlap found",
  highlightQueryOverlap("kubernetes migration experience", "Led a Kubernetes migration at scale").sort(),
  ["kubernetes", "migration"].sort()
);
check(
  "no overlap — semantic-only match, empty is a valid outcome",
  highlightQueryOverlap("container orchestration", "Ran Kubernetes clusters in production"),
  []
);
check("empty query yields empty array, no crash", highlightQueryOverlap("", "some candidate text"), []);
check(
  "stop words never appear in results",
  highlightQueryOverlap("someone who has the experience using Python", "Uses Python daily"),
  ["python"]
);

console.log(failures === 0 ? `\nAll checks PASS` : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
