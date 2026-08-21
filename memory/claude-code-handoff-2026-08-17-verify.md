# Claude Code handoff — verify, then commit onto `feat/jd-checklist`

Purpose of this prompt is different from the two earlier ones today: **double-check this work is actually correct before committing it**, not just package and push. You have real git/network/Supabase access that the sandbox that wrote this doesn't — use it to catch anything that couldn't be verified blind.

## Scope: what's new since the last commit on this branch

1. **Archive Fits stage 2** (deterministic checklist-evidence matching on the Archive Fits tab):
   - `lib/matchArchiveFitToChecklist.ts` (new)
   - `lib/archiveFits.ts` (modified — `listPendingArchiveFits` now joins in checklist matches)
   - `app/projects/[id]/page.tsx` (modified — "Evidence: ..." chips on Archive Fits cards)
   - `test_archive_fit_checklist_match.mjs` (new, root — plain `node` test, 6 cases)

2. **GitHub corroboration** (passive info panel on the Credibility check):
   - `lib/githubCorroboration.ts` (new)
   - `lib/types.ts` (modified — added `GithubCorroboration` interface + `CredibilityAssessment.githubSignal`)
   - `app/api/assess-credibility/route.ts` (modified — extracts a GitHub username from resume text, fetches the public GitHub API, attaches the result to the assessment)
   - `components/CredibilitySection.tsx` (modified — renders a neutral info panel when `githubSignal` is present)
   - `test_github_extract.mjs` (new, root — plain `node` test, 11 cases)

Neither touches `lib/scoreCandidate.ts`, `lib/analyzeJD.ts`, `lib/parseResume.ts`, `lib/calibrationExamples.ts`, or `app/api/screen-resumes/route.ts` (the do-not-touch list). Confirmed via scoped `git diff --stat` on each — zero real diff on any of them from this round (an unrelated, already-documented 2026-08-15 exception comment exists in `scoreCandidate.ts` from earlier work, not this round).

## What genuinely needs YOUR verification (couldn't be checked in the sandbox — no network access)

1. **The actual GitHub API call.** `lib/githubCorroboration.ts`'s `fetchGithubCorroboration()` has never executed against the real `api.github.com`. Specifically confirm:
   - The request succeeds with just a `User-Agent` header (no auth) — GitHub returns 403 without one, this should have it, but verify.
   - The response shape matches what the code expects (`login`, `name`, `company`, `bio`, `public_repos`, `followers`, `created_at`) — run it against a real known GitHub username and eyeball the JSON.
   - A nonexistent username returns 404 and the function returns `null` cleanly (no throw).
   - Rate limiting (60 req/hr unauthenticated) doesn't cause a hard failure anywhere — should degrade to `null`, confirm it does.

2. **End-to-end through the actual credibility check.** Upload/screen a resume that has a real `github.com/<username>` URL in it, run a credibility check on it, and confirm the "GitHub" panel actually renders in `CredibilitySection.tsx` with real data — this was built against the type system and code-reviewed, never seen rendered.

3. **The username-extraction regex against real resumes**, not just the 11 synthetic test cases in `test_github_extract.mjs`. Specifically watch for: usernames GitHub itself would reject (shouldn't matter much, they'd just 404), and any real resume format where the regex might grab the wrong thing (e.g. a GitHub Pages URL like `username.github.io` — currently NOT extracted, since the regex only matches `github.com/...`; decide if that's a gap worth closing).

4. **Archive Fits stage 2 against real data.** `matchCandidateToChecklist`'s coverage-based scoring (`COVERAGE_THRESHOLD = 0.5`) was tuned against 6 hand-written test cases, not real strengths/concerns text. Once `supabase-migration-checklist.sql` is run and a project has both a real checklist and real archived candidates with `strengths`/`concerns`, look at the actual "Evidence: ..." chips it produces — check for both false positives (irrelevant chip shown) and false negatives (an obvious match that didn't fire). The threshold is easy to adjust in one place (`lib/matchArchiveFitToChecklist.ts`) if it's off in either direction.

## Environment quirk to know about before touching git

The Cowork sandbox this was built in showed the **entire repo** as modified in `git status` — this is a mount-level LF→CRLF line-ending artifact, not real changes. Two files this round (`app/api/assess-credibility/route.ts`, `components/CredibilitySection.tsx`) picked up CRLF from the same quirk mid-edit and were normalized back to LF (`sed -i 's/\r$//'`) before their diffs were reviewed — confirmed clean/scoped afterward. This almost certainly won't reproduce in your environment (it's specific to that sandbox's Windows mount), but **do not run `git add -A`** — explicitly `git add` only the files listed below. If `git status` on your end also shows a huge unrelated diff, stop and check `file <path>` / line endings before adding anything broader than this list.

## Files to commit, in full

```
lib/matchArchiveFitToChecklist.ts       (new)
lib/archiveFits.ts                       (modified)
app/projects/[id]/page.tsx               (modified)
test_archive_fit_checklist_match.mjs    (new)
lib/githubCorroboration.ts               (new)
lib/types.ts                             (modified)
app/api/assess-credibility/route.ts      (modified)
components/CredibilitySection.tsx        (modified)
test_github_extract.mjs                 (new)
memory/session-log.md                    (modified — this session's log entry)
memory/claude-code-handoff-2026-08-17-verify.md  (new — this file)
```

Same branch as before: `feat/jd-checklist`. No new branch, no merge to main (main is still blocked on Vlad's separate unmerged `feat/target-company-boost-trajectory-restructure-and-cirot-rebrand` branch — unrelated to this work, not yours to resolve here).

## Before committing

- `npx tsc --noEmit` clean (was clean in the sandbox; re-confirm in your environment).
- `node test_archive_fit_checklist_match.mjs` and `node test_github_extract.mjs` both pass (17/17 combined).
- Re-run the do-not-touch diff check yourself: `git diff --stat -- lib/scoreCandidate.ts lib/analyzeJD.ts lib/parseResume.ts lib/calibrationExamples.ts app/api/screen-resumes/route.ts` should show either nothing, or only the already-known 2026-08-15 `scoreCandidate.ts` exception (documented inline in that file) — nothing new from this round.
- If items 1-4 above turn up a real bug, fix it before committing rather than shipping something you've confirmed is broken — this prompt exists specifically so that doesn't slip through.

## After committing

Two things still block full live-testing of everything on this branch (pre-existing, not new):
- `supabase/migrations/supabase-migration-checklist.sql` has not been run against the real database yet.
- The branch itself hasn't been merged/rebased onto Vlad's other unmerged branch.

Report back what you found in items 1-4 — especially anything that required a code change, so it's clear what shipped vs. what was caught and fixed.
