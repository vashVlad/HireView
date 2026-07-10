-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Resume Content Hash — pre-screen duplicate detection
-- Run this in Supabase SQL editor → Run
--
-- Lets the app detect "this exact resume already exists in this project"
-- BEFORE spending a Claude scoring call on it. resume_content_hash is a
-- SHA-256 of the extracted, normalized resume text (not the raw file bytes,
-- so a re-exported/renamed copy of the same content still matches; not the
-- score or any Claude output, so this costs nothing to compute or check).
--
-- Distinct from resume_fingerprints (Phase 1.1/1.4): that's a fuzzy,
-- identity-scrubbed semantic match built to catch fraud (same person,
-- reworded resume, swapped identity), and always requires a Claude call to
-- produce. This is a cheap exact-match pre-check to avoid re-scoring a
-- literal duplicate upload — a different problem, a different mechanism.
--
-- Additive only, no backfill: existing screenings simply have no hash until
-- they're naturally re-touched. The pre-check only needs to work going
-- forward — same approach taken for team_id and history_alert_type before it.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE screenings ADD COLUMN IF NOT EXISTS resume_content_hash text;

-- Composite index: the check-existing endpoint always queries by
-- (project_id, resume_content_hash) together, scoped to one project's
-- screenings — this keeps the lookup fast regardless of how large the
-- screenings table grows overall.
CREATE INDEX IF NOT EXISTS screenings_project_resume_hash_idx
  ON screenings(project_id, resume_content_hash)
  WHERE resume_content_hash IS NOT NULL;
