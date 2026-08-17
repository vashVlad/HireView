/**
 * GitHub corroboration, 2026-08-17 (roadmap 2.5.3, Vlad's ask — "fold a free
 * GitHub API fetch into the existing cross-reference check as a third
 * evidence source"). Split from lib/assessCredibility.ts on purpose:
 *
 * assessCredibility.ts's prompt is a heavily tuned, single AI judgment call
 * (staffing-agency tolerance, LinkedIn date-rounding tolerance, the 7-rule
 * severity classification, the education year-subtraction rule — all
 * calibrated against real live-tested cases per that file's own comments).
 * This sandbox has zero live network access (api.github.com and
 * *.supabase.co both fail DNS resolution here — confirmed repeatedly this
 * session), so nothing that involves an actual AI call or a real GitHub API
 * response can be verified before Vlad/Claude Code run it live. Feeding
 * GitHub data straight into that prompt as new context is real risk to a
 * working, tuned system with no way to catch a regression here.
 *
 * So this file stays 100% deterministic and code-side: extract a claimed
 * GitHub username from resume text (regex, unit-testable), fetch the
 * public, unauthenticated GitHub Users API for it (best-effort, fails
 * closed to null on ANY error — 404, rate limit, network failure, malformed
 * response — same "never block the main check" pattern as every other
 * isolated read in this codebase), and hand back plain facts. The
 * assess-credibility route attaches the result directly onto the assessment
 * as a passthrough field (see CredibilityAssessment.githubSignal in
 * lib/types.ts) — assessCredibility.ts itself is untouched, and the
 * recruiter sees the raw GitHub stats alongside the AI's verdict rather
 * than trusting the AI to have correctly reasoned about them blind.
 *
 * Next increment (deliberately NOT built here, needs live testing first):
 * once Vlad/Claude Code confirm this fetch works against the real GitHub
 * API, folding a short summary of it into assessCredibility.ts's prompt so
 * the model can flag a "claims senior backend role, GitHub account created
 * 3 months ago with 0 public repos" style inconsistency — the actual
 * synthesis Vlad originally asked for. This layer is the safe, verifiable
 * foundation for that, not the final feature.
 */

import type { GithubCorroboration } from "./types";
export type { GithubCorroboration };

// Reserved GitHub path segments that look like a username in a bare
// `github.com/<segment>` match but are never actual user profiles — without
// this list, a resume mentioning e.g. "github.com/features/copilot" or a
// generic "github.com/about" link would be mis-extracted as a claimed
// username and trigger a pointless (or misleading) API lookup.
const RESERVED_PATHS = new Set([
  "about", "features", "pricing", "marketplace", "sponsors", "orgs",
  "topics", "collections", "trending", "explore", "notifications",
  "settings", "issues", "pulls", "codespaces", "apps", "login", "join",
  "site", "security", "contact", "customer-stories", "readme", "resources",
  "solutions", "team", "enterprise", "education", "sponsors", "events",
]);

// Matches github.com/<username> (optionally preceded by www. or a scheme),
// capturing just the first path segment — deliberately ignores anything
// after a second slash (repo name, tab name, etc.) since only the profile
// owner matters here. Usernames are alphanumeric/hyphen per GitHub's own
// rules, 1-39 chars.
//
// Terminator class, fixed 2026-08-17 (live-verified against real-world
// resume phrasing, not just the synthetic test cases): the original class
// (`[\/\s)"'>,]` or end-of-string) missed two extremely common real cases —
// a URL ending a sentence ("...at github.com/janedoe.") and a URL carrying
// a query string copy-pasted straight from a browser address bar
// ("github.com/janedoe?tab=repositories") — both silently failed to match
// at all (not a partial match, the whole regex missed), which would have
// meant most real profile links straight out of a browser or resume prose
// never triggered this feature. `.`/`?`/`#` are safe additions since none
// of them are legal GitHub username characters (the capture group's own
// charset already excludes them), so widening the terminator set can only
// ever recognize more real URLs, never mis-truncate a valid username.
const GITHUB_URL_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38}))(?:[\/\s)"'>,.?#]|$)/i;

// GitHub Pages URLs (<username>.github.io) are a common secondary signal on
// developer resumes — the username IS the subdomain. Same terminator-class
// reasoning as GITHUB_URL_RE above. Tried only as a fallback, after
// GITHUB_URL_RE, since a direct github.com profile link is the more
// explicit/certain identity claim when both are present.
const GITHUB_IO_RE = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38}))\.github\.io(?:[\/\s)"'>,.?#]|$)/i;

/**
 * Best-effort extraction of a claimed GitHub username from raw resume text.
 * Returns the first plausible match, or null if none found. Deliberately
 * simple/deterministic (no AI call) — same reasoning as
 * lib/matchArchiveFitToChecklist.ts's word-overlap matching: this is a
 * cheap, always-available signal that shouldn't cost anything to compute.
 */
export function extractGithubUsername(text: string): string | null {
  if (!text) return null;
  const match = text.match(GITHUB_URL_RE);
  if (match) {
    const username = match[1];
    if (username && !RESERVED_PATHS.has(username.toLowerCase())) return username;
  }
  const ioMatch = text.match(GITHUB_IO_RE);
  if (ioMatch) {
    const username = ioMatch[1];
    // "www" itself is never a real username here — www.github.io isn't a
    // profile, and the www-prefix branch of the regex above can otherwise
    // capture it literally.
    if (username && username.toLowerCase() !== "www" && !RESERVED_PATHS.has(username.toLowerCase())) return username;
  }
  return null;
}

interface GithubUserApiResponse {
  login: string;
  name: string | null;
  company: string | null;
  bio: string | null;
  public_repos: number;
  followers: number;
  created_at: string | null;
}

/**
 * Fetches the public, unauthenticated GitHub Users API for a username.
 * Fails closed to null on any error — this must never be able to block or
 * fail the credibility check itself, only enrich it when available. GitHub
 * requires a User-Agent header on unauthenticated requests (returns 403
 * without one) and rate-limits unauthenticated calls fairly aggressively
 * (60/hr per IP) — both expected, both handled by the same catch-all.
 *
 * NOT live-tested (this sandbox has no network access to api.github.com —
 * confirmed via DNS failure earlier this session). The request shape below
 * follows GitHub's documented REST API exactly; Claude Code or Vlad should
 * confirm a real call succeeds before this is trusted in production.
 */
export async function fetchGithubCorroboration(username: string): Promise<GithubCorroboration | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let res: Response;
    try {
      res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
        headers: {
          "User-Agent": "cirot-recruiting-assistant",
          Accept: "application/vnd.github+json",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return null; // 404 (no such user), 403 (rate limit), etc. — all treated the same, just "no signal available"

    const data = (await res.json()) as GithubUserApiResponse;
    if (!data || !data.login) return null;

    const createdYear = data.created_at ? new Date(data.created_at).getFullYear() : null;

    return {
      username: data.login,
      profileUrl: `https://github.com/${data.login}`,
      name: data.name ?? null,
      company: data.company ?? null,
      bio: data.bio ?? null,
      publicRepos: typeof data.public_repos === "number" ? data.public_repos : 0,
      followers: typeof data.followers === "number" ? data.followers : 0,
      accountCreatedYear: createdYear !== null && !isNaN(createdYear) ? createdYear : null,
    };
  } catch {
    return null;
  }
}
