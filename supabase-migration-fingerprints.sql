-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Duplicate Resume Detection (Phase 1.1)
-- Run this in Supabase SQL editor → Run
--
-- Fingerprints resumes on content — skills hash, responsibility vectors, metric
-- claims, career arc signature — never on name, contact info, or company names.
-- Scoped per-project for v1.1 (cross-project matching is Feature 1.4, once Teams
-- (1.3) exists to define what "same team" means for isolation).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS resume_fingerprints (
  id                      bigserial primary key,
  screening_id            bigint NOT NULL REFERENCES screenings(id) ON DELETE CASCADE,
  project_id              bigint REFERENCES projects(id) ON DELETE SET NULL,
  skills_hash             text NOT NULL DEFAULT '',
  responsibility_vectors  text[] NOT NULL DEFAULT '{}',
  metric_claims           text[] NOT NULL DEFAULT '{}',
  career_arc_signature    text NOT NULL DEFAULT '',
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS resume_fingerprints_screening_id_idx ON resume_fingerprints(screening_id);
CREATE INDEX IF NOT EXISTS resume_fingerprints_project_id_idx ON resume_fingerprints(project_id);
CREATE INDEX IF NOT EXISTS resume_fingerprints_skills_hash_idx ON resume_fingerprints(skills_hash);

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS duplicate_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_match_id bigint REFERENCES screenings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS screenings_duplicate_flag_idx ON screenings(duplicate_flag) WHERE duplicate_flag = true;

-- Existing screenings/projects are unaffected — new columns default to false/null,
-- no backfill needed, no data loss.
