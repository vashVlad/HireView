-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Track previous status/stage (prep for FunnelView CSV export)
-- Run this in Supabase SQL editor → Run
--
-- `status` and `stage` already represent the CURRENT value — not renamed,
-- per the additive-only schema rule (both are referenced throughout the app).
-- This adds previous_status/previous_stage columns that a trigger keeps in
-- sync automatically, so "where did this candidate come from" is available
-- no matter which code path changes status/stage.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── screenings.status → previous_status ─────────────────────────────────────

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS previous_status text;

CREATE OR REPLACE FUNCTION track_previous_screening_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.previous_status := OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS screenings_track_previous_status ON screenings;
CREATE TRIGGER screenings_track_previous_status
  BEFORE UPDATE ON screenings
  FOR EACH ROW
  EXECUTE FUNCTION track_previous_screening_status();

-- ── tracker.stage → previous_stage ───────────────────────────────────────────

ALTER TABLE tracker
  ADD COLUMN IF NOT EXISTS previous_stage text;

CREATE OR REPLACE FUNCTION track_previous_tracker_stage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.previous_stage := OLD.stage;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tracker_track_previous_stage ON tracker;
CREATE TRIGGER tracker_track_previous_stage
  BEFORE UPDATE ON tracker
  FOR EACH ROW
  EXECUTE FUNCTION track_previous_tracker_stage();

-- Existing rows: previous_status/previous_stage stay NULL until the next
-- change on each row — no backfill possible since prior values were never
-- recorded. No data loss, no breaking change.
