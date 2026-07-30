-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Exclude a project from Cross-Project Fit Suggestions
-- Run this in Supabase SQL editor → Run
--
-- Vlad's ask, 2026-07-30: a per-project Settings toggle so a role can opt
-- OUT of being suggested as a "better fit" target when a candidate scores
-- below threshold on some OTHER project. Phase 2.1's Cross-Project Fit
-- Suggestion (app/api/cross-project-fit/route.ts,
-- app/api/cross-project-fit/gate/route.ts) currently checks every other
-- ACTIVE project in the recruiter's team automatically — there was no way
-- to keep a specific role out of that pool (e.g. a role that's about to
-- close, or one Vlad doesn't want other candidates funneled into).
--
-- Deliberately additive and defaulted to false (opt-out, not opt-in) — every
-- existing project keeps behaving exactly as it does today; this only takes
-- effect once a recruiter explicitly flips it in Settings.
--
-- IMPORTANT — run this BEFORE deploying the code that reads/writes it.
-- Kept OUT of the shared listProjects()/getProject() select in
-- lib/projects.ts (both are used all over the app — Projects page,
-- Settings, cross-project-fit) — same Migration Sequencing rule as every
-- other deferred column this project uses (see archive_reason's migration
-- for the fuller rationale; a column referenced in a shared, heavily-used
-- select before its migration runs caused a real app-wide outage on
-- 2026-07-09). Read via an isolated, single-purpose helper
-- (getFitExclusionMap in lib/projects.ts) that fails closed to "not
-- excluded" on any error, including this column not existing yet — so
-- nothing breaks either way, the toggle just silently does nothing until
-- this migration runs.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS exclude_from_fit_suggestions boolean NOT NULL DEFAULT false;

-- No backfill needed — every existing project defaults to false (included),
-- matching current behavior exactly.
