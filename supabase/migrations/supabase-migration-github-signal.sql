-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: github_signal on screenings
-- Run this in Supabase SQL editor → Run
--
-- Backs surfacing a candidate's GitHub profile during the INITIAL screening
-- (Vlad's ask, 2026-08-26: "pull and show [GitHub links] during the initial
-- screening... up top nicely before the trajectory"). Extraction/lookup
-- itself was already built 2026-08-17 (roadmap 2.5.3, lib/githubCorroboration.ts)
-- but was only ever wired into the post-hoc cross-reference check
-- (CredibilityAssessment.githubSignal) — this column is the same free,
-- code-side, no-AI-cost GithubCorroboration payload, just captured at
-- screening time instead (app/api/screen-resumes/route.ts, do-not-touch
-- exception) so it's available immediately on the post-screening ResultCard
-- and survives a reload without an extra step.
--
-- Stored as jsonb, not separate columns — GithubCorroboration is a small,
-- stable, code-side-only shape (username/profileUrl/name/company/bio/
-- publicRepos/followers/accountCreatedYear), same reasoning as how
-- checklist_evaluation and suggested_role_fits are stored.
--
-- Deliberately kept OUT of the shared SCREENING_COLUMNS select (see that
-- constant's own comment in lib/screenings.ts) — read back via a separate
-- attachGithubSignals() isolated fetch, same deferred-column pattern as
-- linkedin_url/checklist_evaluation. Frequently NULL — not every resume
-- lists a GitHub link, and a candidate screened before this migration ran
-- will never have one until re-screened; that's expected, not a bug.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS github_signal jsonb;
