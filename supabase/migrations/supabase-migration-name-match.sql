-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Candidate Name Match — same-project, informational
-- Run this in Supabase SQL editor → Run
--
-- Neither resume_content_hash (exact re-upload) nor resume_fingerprints
-- (Phase 1.1's fuzzy, identity-scrubbed fraud match) catches "two genuinely
-- different resume files that happen to name the same candidate in this
-- project" — e.g. two different resume personas for the same real person.
-- name_match_id is a pure candidate_name comparison, computed for free
-- (no Claude call) in lib/screenings.ts's saveScreening, right alongside the
-- existing duplicate_flag check. Skipped when duplicate_flag already fired
-- for this save, since that pairing already implies a name match too.
--
-- Deliberately NOT a fraud signal like duplicate_flag/history_alert_type —
-- just "worth a second look," so it renders as a distinct, lower-alarm badge.
--
-- Additive only, no backfill: only applies going forward, same approach as
-- every other signal column added this project.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE screenings ADD COLUMN IF NOT EXISTS name_match_id bigint REFERENCES screenings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS screenings_name_match_id_idx ON screenings(name_match_id) WHERE name_match_id IS NOT NULL;
