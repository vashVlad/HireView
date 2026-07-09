-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Recruiter Attribution (Phase 1.2)
-- Run this in Supabase SQL editor → Run
--
-- Logs who did what to a candidate, and when. Separate from previous_status/
-- previous_stage (which only ever hold the LATEST transition) — this is a full
-- append-only history, one row per action, so a candidate's whole timeline can
-- be reconstructed: "Vlad screened John on July 7. Teti moved John to
-- Recruiter Screen on July 8."
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS screening_actions (
  id           bigserial primary key,
  screening_id bigint NOT NULL REFERENCES screenings(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type  text NOT NULL, -- 'created' | 'status_change' | 'stage_change' | 'flagged' | 'unflagged' | 'note' | 'credibility_check'
  from_value   text,
  to_value     text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS screening_actions_screening_id_idx ON screening_actions(screening_id);
CREATE INDEX IF NOT EXISTS screening_actions_created_at_idx ON screening_actions(created_at);

-- No backfill — action history starts from whenever this migration runs.
-- Existing candidates simply have no timeline entries before this point.
