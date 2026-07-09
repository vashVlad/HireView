-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Candidate History Alert (Phase 1.4)
-- Run this in Supabase SQL editor → Run
--
-- Extends Phase 1.1's fingerprint matching across projects, scoped to a team
-- (the boundary Phase 1.3 defined) — same-project matching (1.1's red
-- "Duplicate detected" badge, duplicate_flag/duplicate_match_id) is untouched.
--
-- Two new banners, both driven by a cross-project fingerprint match within
-- the same team:
--   'previously_seen'      — yellow. This content pattern showed up in another
--                             project before, no prior fraud signal attached.
--   'known_fraud_pattern'  — red. The matched record (or this one) already
--                             carries a same-project duplicate_flag, or was
--                             itself already 'known_fraud_pattern' — the
--                             escalation propagates through the match chain.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE resume_fingerprints ADD COLUMN IF NOT EXISTS team_id bigint REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS resume_fingerprints_team_id_idx ON resume_fingerprints(team_id);

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS history_alert_type text, -- 'previously_seen' | 'known_fraud_pattern' | null
  ADD COLUMN IF NOT EXISTS history_alert_match_id bigint REFERENCES screenings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS screenings_history_alert_type_idx ON screenings(history_alert_type) WHERE history_alert_type IS NOT NULL;

-- Backfill resume_fingerprints.team_id from the screening it belongs to
-- (screenings.team_id was populated by Phase 1.3's migration).
UPDATE resume_fingerprints rf
SET team_id = s.team_id
FROM screenings s
WHERE rf.screening_id = s.id AND rf.team_id IS NULL;

-- No history-alert backfill for existing screenings — cross-project matching
-- only runs going forward, same approach 1.1 took (no retroactive scan).
