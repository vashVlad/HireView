// Plain-Node verification of extractNameHeuristic's logic (mirrors it
// directly, since the real module imports the Anthropic client). Run:
// node test_extract_name_heuristic.mjs
//
// 2026-08-19, Phase 2.6 — gate-1-only candidates need a candidateName from
// somewhere other than scoreCandidate() (which never runs for them). This is
// the free, pure first pass: a resume's name is almost always one of the
// first few non-empty lines, short, no digits, no "resume"/"cv" boilerplate,
// 2-4 capitalized words.

function extractNameHeuristic(resumeText) {
  const firstLines = resumeText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);

  for (const line of firstLines) {
    if (line.length < 2 || line.length > 60) continue;
    if (/[@\d]/.test(line)) continue;
    if (/resume|curriculum vitae|\bcv\b/i.test(line)) continue;
    const words = line.split(/\s+/);
    if (
      words.length >= 2 &&
      words.length <= 4 &&
      words.every((w) => /^[A-Z][a-zA-Z'.-]*$/.test(w))
    ) {
      return line;
    }
  }
  return null;
}

const cases = [
  {
    name: "plain name on first line",
    text: "Jane Smith\nSoftware Engineer\njane@example.com",
    expect: "Jane Smith",
  },
  {
    name: "name with middle initial and hyphenated surname",
    text: "Maria J. Alvarez-Cruz\n555-123-4567",
    expect: "Maria J. Alvarez-Cruz",
  },
  {
    name: "blank lines before the name",
    text: "\n\n   \nJohn Doe\nRESUME",
    expect: "John Doe",
  },
  {
    name: "skips a leading 'RESUME' header line",
    text: "RESUME\nJohn Doe\nSenior Developer",
    expect: "John Doe",
  },
  {
    name: "skips an email-only first line",
    text: "john.doe@email.com\nJohn Doe",
    expect: "John Doe",
  },
  {
    name: "skips an address line with digits",
    text: "123 Main St, Springfield\nJohn Doe",
    expect: "John Doe",
  },
  {
    name: "no confident match — single word only",
    text: "Objective\nSeeking a role in software engineering",
    expect: null,
  },
  {
    name: "no confident match — line too long",
    text: "Experienced Full Stack Software Engineering Professional Available",
    expect: null,
  },
  {
    name: "no confident match — lowercase words",
    text: "hello world\nsome text",
    expect: null,
  },
  {
    name: "empty text",
    text: "",
    expect: null,
  },
  {
    name: "name beyond the first 6 lines is not found (deliberate cutoff)",
    text: "1\n2\n3\n4\n5\n6\nJohn Doe",
    expect: null,
  },
];

let pass = 0;
for (const c of cases) {
  const got = extractNameHeuristic(c.text);
  const ok = got === c.expect;
  console.log(`${ok ? "PASS" : "FAIL"} — ${c.name} (got: ${JSON.stringify(got)}, expect: ${JSON.stringify(c.expect)})`);
  if (ok) pass++;
}
console.log(`\n${pass}/${cases.length} passed`);
if (pass !== cases.length) process.exit(1);
