// Plain-Node verification of extractGithubUsername's regex/reserved-path
// logic (mirrors lib/githubCorroboration.ts directly). Run: node test_github_extract.mjs

const RESERVED_PATHS = new Set([
  "about", "features", "pricing", "marketplace", "sponsors", "orgs",
  "topics", "collections", "trending", "explore", "notifications",
  "settings", "issues", "pulls", "codespaces", "apps", "login", "join",
  "site", "security", "contact", "customer-stories", "readme", "resources",
  "solutions", "team", "enterprise", "education", "sponsors", "events",
]);

const GITHUB_URL_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38}))(?:[\/\s)"'>,.?#]|$)/i;
const GITHUB_IO_RE = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38}))\.github\.io(?:[\/\s)"'>,.?#]|$)/i;

function extractGithubUsername(text) {
  if (!text) return null;
  const match = text.match(GITHUB_URL_RE);
  if (match) {
    const username = match[1];
    if (username && !RESERVED_PATHS.has(username.toLowerCase())) return username;
  }
  const ioMatch = text.match(GITHUB_IO_RE);
  if (ioMatch) {
    const username = ioMatch[1];
    if (username && username.toLowerCase() !== "www" && !RESERVED_PATHS.has(username.toLowerCase())) return username;
  }
  return null;
}

const cases = [
  { name: "bare domain, no scheme", text: "GitHub: github.com/johndoe", expect: "johndoe" },
  { name: "full https URL", text: "Portfolio at https://github.com/jane-doe123 — see my work", expect: "jane-doe123" },
  // Real GitHub usernames can never contain underscores (GitHub itself
  // rejects them at signup), so a resume typo/fake URL like this correctly
  // yields no match rather than a truncated wrong guess — confirmed via a
  // real run of this test, not assumed.
  { name: "www prefix, underscore (invalid GitHub username char)", text: "www.github.com/alice_dev", expect: null },
  { name: "trailing slash + repo path ignored", text: "github.com/bobsmith/my-cool-repo", expect: "bobsmith" },
  { name: "parenthesized in resume text", text: "(github.com/carla-eng)", expect: "carla-eng" },
  { name: "no github mention at all", text: "Experienced backend engineer with AWS and Python skills.", expect: null },
  { name: "reserved path — features, not a user", text: "Check out github.com/features/actions for CI", expect: null },
  { name: "reserved path — about", text: "See github.com/about for company info", expect: null },
  { name: "first match wins when multiple present", text: "github.com/realuser and later mentions github.com/anotheruser too", expect: "realuser" },
  { name: "case insensitive domain", text: "GITHUB.COM/UpperCaseUser", expect: "UpperCaseUser" },
  { name: "empty string", text: "", expect: null },
  // Real bugs found and fixed 2026-08-17, live-verified against realistic
  // resume phrasing (see lib/githubCorroboration.ts's GITHUB_URL_RE comment)
  // — both silently failed to match at all before the terminator class was
  // widened to include ".", "?", "#".
  { name: "trailing sentence period", text: "Check out my work at github.com/janedoe.", expect: "janedoe" },
  { name: "URL query string (copy-pasted from browser)", text: "https://github.com/janedoe?tab=repositories", expect: "janedoe" },
  { name: "URL fragment", text: "github.com/janedoe#readme", expect: "janedoe" },
  { name: "GitHub Pages fallback (no github.com link at all)", text: "Portfolio: janedoe.github.io", expect: "janedoe" },
  { name: "GitHub Pages with www prefix", text: "www.janedoe.github.io", expect: "janedoe" },
  { name: "bare www.github.io — not a real username", text: "www.github.io", expect: null },
  { name: "github.com preferred over github.io when both present", text: "github.com/realuser and also seen at otheruser.github.io", expect: "realuser" },
];

let failures = 0;
for (const c of cases) {
  const result = extractGithubUsername(c.text);
  const pass = result === c.expect;
  if (!pass) {
    failures++;
    console.error(`FAIL: ${c.name} — expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(result)}`);
  } else {
    console.log(`PASS: ${c.name} — got ${JSON.stringify(result)}`);
  }
}

console.log(failures === 0 ? `\nAll ${cases.length} PASS` : `\n${failures}/${cases.length} FAILED`);
process.exit(failures === 0 ? 0 : 1);
