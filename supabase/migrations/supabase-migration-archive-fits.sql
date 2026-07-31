-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Archive Fits (re-screening archived candidates for new roles)
-- Run this in Supabase SQL editor → Run
--
-- Vlad's ask, 2026-07-30: reuse the archive instead of losing track of
-- candidates who just weren't right for the role they were originally
-- screened against. Two pieces:
--
-- 1. screenings.suggested_role_fits — a list of short role/title suggestions
--    for a candidate, generated automatically at archive time (see
--    lib/generateRoleFit.ts) for role-mismatch archive reasons (Tech
--    skills / Domain knowledge / Role alignment / the auto-archive default),
--    or added manually by a recruiter. Deliberately independent of any
--    specific JD — this is "what kind of role would this person actually
--    fit," not a comparison against one project.
--
-- 2. archive_fit_candidates — the per-project review queue. Populated by
--    POST /api/projects/[id]/archive-fits/check, which cheaply classifies
--    every archived candidate's suggested_role_fits against a NEW project's
--    JD and inserts one 'pending' row per match. A recruiter then works
--    through /api/projects/[id]/archive-fits (the Archive Fits tab),
--    resolving each row to 'screened' (re-scored + moved into this
--    project's pipeline) or 'skipped' (candidate stays archived, untouched,
--    just excluded from ever being re-suggested for THIS project again).
--    unique(project_id, screening_id) so a re-run of "check" never
--    duplicates or resurrects a decision already made.
--
-- Additive only. suggested_role_fits defaults to '{}' so every existing
-- screening reads as "no suggestions yet" rather than null.
--
-- checked_by/decided_by, added 2026-07-30 (Vlad's ask: "make sure userID
-- captures everywhere it has to be captured") — every other write in this
-- app that represents a real recruiter decision is attributed
-- (screening_actions, tracker updates), and this table's rows are exactly
-- that (who ran the check, who chose Screen vs. Skip), so it should be too.
-- Both nullable + ON DELETE SET NULL, same as every other actor column in
-- this schema (screening_actions.user_id) — a deleted user should never
-- block a row from existing.
--
-- IMPORTANT — same sequencing rule as every other migration here (see
-- feedback_migration_sequencing in the memory vault): these columns/tables
-- are NOT wired into the shared SCREENING_COLUMNS select every Pipeline/All
-- Candidates load uses. All reads/writes go through dedicated new routes
-- only, until this migration is confirmed run.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE screenings ADD COLUMN IF NOT EXISTS suggested_role_fits text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS archive_fit_candidates (
  id                  bigserial PRIMARY KEY,
  project_id          bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  screening_id        bigint NOT NULL REFERENCES screenings(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'skipped', 'screened')),
  suggested_role_fit  text,
  screened_screening_id bigint REFERENCES screenings(id) ON DELETE SET NULL,
  checked_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  decided_at          timestamptz,
  UNIQUE (project_id, screening_id)
);

CREATE INDEX IF NOT EXISTS archive_fit_candidates_project_id_idx ON archive_fit_candidates(project_id);
CREATE INDEX IF NOT EXISTS archive_fit_candidates_screening_id_idx ON archive_fit_candidates(screening_id);
CREATE INDEX IF NOT EXISTS archive_fit_candidates_status_idx ON archive_fit_candidates(status);
