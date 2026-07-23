-- ─────────────────────────────────────────────────────────────────────────────
-- BOOTSTRAP: core tables that predate this project's migration-file convention
-- Run this FIRST, before any other file in supabase/migrations/.
--
-- Written 2026-07-23 as part of the Brillio enterprise-pilot database
-- migration readiness pass (see memory/decisions-log.md and
-- docs/HireView-Database-Migration-Runbook.md).
--
-- WHY THIS FILE EXISTS: three tables — screenings, tracker, and
-- calibration_examples — were created directly in the Supabase dashboard
-- early in this project's life, before any SQL migration file existed for
-- them. Every other table in supabase/migrations/ has a real CREATE TABLE
-- somewhere; these three only ever appear as ALTER TABLE targets (e.g.
-- supabase-migration-projects.sql's "ALTER TABLE screenings ADD COLUMN
-- project_id" assumes screenings already exists). On a brand-new database,
-- those ALTER TABLE statements would fail with "relation does not exist."
-- This file reconstructs all three tables in their CURRENT, final shape —
-- i.e. already including every column every later migration would otherwise
-- add — so every existing migration's "ADD COLUMN IF NOT EXISTS" becomes a
-- safe no-op instead of something this bootstrap depends on running in a
-- precise historical order. Reconstructed from the actual TypeScript
-- row/select shapes in lib/screenings.ts and lib/calibrationExamples.ts,
-- cross-checked against every ALTER TABLE statement in the other 21
-- migration files — not guessed.
--
-- Safe to re-run (IF NOT EXISTS throughout).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── screenings ───────────────────────────────────────────────────────────────
-- One row per screened candidate. This is the single largest, most central
-- table in the app — nearly every feature reads or writes it.

CREATE TABLE IF NOT EXISTS screenings (
  id                       bigserial PRIMARY KEY,
  candidate_name           text NOT NULL DEFAULT 'Unknown',
  file_name                text NOT NULL DEFAULT '',
  score                    integer NOT NULL DEFAULT 0,
  must_have_score          integer,
  nice_to_have_score       integer,
  summary                  text NOT NULL DEFAULT '',
  strengths                text[] NOT NULL DEFAULT '{}',
  concerns                 text[] NOT NULL DEFAULT '{}',
  career_trajectory        text,
  recommendation           text,                          -- 'proceed' | 'decline'
  status                   text NOT NULL DEFAULT 'new_applicant',
  status_updated_at        timestamptz,                    -- set by app code (lib/screenings.ts), never had its own migration file
  job_description          text NOT NULL DEFAULT '',
  resume_path              text NOT NULL DEFAULT '',       -- storage key inside the "resumes" bucket
  resume_mime_type         text NOT NULL DEFAULT 'application/pdf',
  flagged                  boolean NOT NULL DEFAULT false,
  flag_note                text,
  notes                    text,
  lever_url                text,
  credibility              jsonb,                          -- CredibilityAssessment blob (lib/assessCredibility.ts)
  created_at               timestamptz NOT NULL DEFAULT now(),
  -- Columns added by later migrations, included here up front so those
  -- migrations' own ADD COLUMN statements become safe no-ops:
  linkedin_mode            boolean NOT NULL DEFAULT false,
  interview_questions      text[],
  linkedin_pdf_path        text,
  photo_url                text,
  user_id                  uuid,
  project_id               integer REFERENCES projects(id) ON DELETE SET NULL,
  team_id                  bigint,                         -- FK added once teams exists, see below
  duplicate_flag           boolean NOT NULL DEFAULT false,
  duplicate_match_id       bigint REFERENCES screenings(id) ON DELETE SET NULL,
  history_alert_type       text,                           -- 'previously_seen' | 'known_fraud_pattern'
  history_alert_match_id   bigint REFERENCES screenings(id) ON DELETE SET NULL,
  name_match_id            bigint REFERENCES screenings(id) ON DELETE SET NULL,
  previous_status          text,
  archive_reason           text,
  agency_name              text,
  resume_content_hash      text
);

-- Note: the projects(id) FK above requires supabase-migration-projects.sql's
-- CREATE TABLE to run first if you're bootstrapping in one pass without it —
-- see the runbook for the full run order. If running this file completely
-- standalone before projects exists, drop the REFERENCES clause and rely on
-- supabase-migration-projects.sql's own ALTER TABLE to add the FK instead.

CREATE INDEX IF NOT EXISTS screenings_candidate_name_idx ON screenings USING gin (to_tsvector('english', candidate_name));
CREATE INDEX IF NOT EXISTS screenings_status_idx ON screenings(status);
CREATE INDEX IF NOT EXISTS screenings_created_at_idx ON screenings(created_at);

-- ── tracker ──────────────────────────────────────────────────────────────────
-- One row per screening that has entered the interview pipeline (TA → L1 →
-- L2 → In-Person → Offer/Reject). 1:1 with screenings via screening_id.

CREATE TABLE IF NOT EXISTS tracker (
  id                bigserial PRIMARY KEY,
  screening_id      bigint NOT NULL UNIQUE REFERENCES screenings(id) ON DELETE CASCADE,
  stage             text,                        -- TrackerStage: 'TA' | 'L1' | 'L2' | 'In-Person' | 'Offer' | 'Reject' | null (unplaced)
  lever_id          text,
  company            text,
  role              text,
  expected_level    text,
  steps_completed   text[] NOT NULL DEFAULT '{}',
  comments          text,
  immigration       text,
  on_hold           boolean NOT NULL DEFAULT false,
  on_hold_reason    text,
  scheduled         boolean NOT NULL DEFAULT false,
  interview_date    timestamptz,
  order_index       integer NOT NULL DEFAULT 0,   -- drag-to-reorder position within a stage column
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Columns added by later migrations:
  reject_reason     text,
  location          text,
  previous_stage    text
);

CREATE INDEX IF NOT EXISTS tracker_screening_id_idx ON tracker(screening_id);
CREATE INDEX IF NOT EXISTS tracker_stage_idx ON tracker(stage);

-- ── calibration_examples ─────────────────────────────────────────────────────
-- Recruiter-marked "hireable"/"not hireable" example resumes used to
-- calibrate scoring for a role (lib/scoreCandidate.ts, do-not-touch — reads
-- this table's contents but never writes it).

CREATE TABLE IF NOT EXISTS calibration_examples (
  id                 bigserial PRIMARY KEY,
  label              text NOT NULL,                -- 'good' | 'bad'
  note               text,
  file_name          text NOT NULL DEFAULT '',
  resume_path        text NOT NULL DEFAULT '',      -- storage key inside the "resumes" bucket
  resume_mime_type   text NOT NULL DEFAULT 'application/pdf',
  extracted_text     text NOT NULL DEFAULT '',
  project_id         integer REFERENCES projects(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Column added by a later migration:
  user_id            uuid
);

CREATE INDEX IF NOT EXISTS calibration_examples_project_id_idx ON calibration_examples(project_id);

-- ── RLS reality check — read before assuming Postgres RLS is an access
-- control boundary in this app ──────────────────────────────────────────────
--
-- HireView's Next.js server ALWAYS talks to Supabase via the service-role
-- key (lib/supabase.ts's getSupabaseClient(), explicitly documented there as
-- bypassing RLS). Every access-control decision — which team's projects a
-- recruiter can see, whether a candidate belongs to their team, admin vs.
-- recruiter — is enforced in the Next.js API route layer (lib/auth.ts:
-- teamIdsFilter(), canAccessProject(), canAccessScreening(), etc.), NOT via
-- Postgres RLS policies. The only place the public/anon key is used at all
-- is Supabase Auth itself (session cookies, sign-in) — never for data reads
-- or writes.
--
-- Practical implication for migrating to a new/enterprise Postgres instance:
-- RLS policies are NOT the security boundary to reproduce carefully — the
-- app-layer checks in lib/auth.ts are. RLS is disabled outright on the two
-- tables where that was ever explicit (access_requests, feedback — see
-- their own migration files); every other table has simply never had RLS
-- policies written, since the service-role key ignores them regardless. If
-- Brillio's DBA/security team wants defense-in-depth RLS as a second layer
-- (recommended for an enterprise deployment, even though the app doesn't
-- currently depend on it), that would be new work, not a migration of
-- anything that exists today — flag this explicitly rather than implying a
-- policy set already exists to "document."
