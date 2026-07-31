-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Candidate blacklist
-- Run this in Supabase SQL editor → Run
--
-- Vlad's ask, 2026-07-31: "When a person is archived, let the recruiter
-- blacklist the person if needed, which will be shown during the screening
-- if the same person is applying for a different role."
--
-- Deliberately system-wide, not team-scoped — same precedent as
-- reject_reason's cross-team rejection history (supabase-migration-
-- reject-reason.sql) — a blacklisted candidate should be flagged for ANY
-- recruiter who screens them again, not just the recruiter/team who
-- blacklisted them. See lib/screenings.ts's listBlacklist().
--
-- Additive only, no backfill. blacklisted defaults to false so every
-- existing row reads as "not blacklisted" with no ambiguity (NULL would mean
-- the same thing here, but a plain boolean with a default keeps every query
-- simpler — no `blacklisted IS NOT TRUE` needed).
--
-- IMPORTANT — deferred-wiring pattern, same as archive_reason/fraud_risk
-- before it: NOT added to the shared SCREENING_COLUMNS select
-- (lib/screenings.ts) until this migration is confirmed run everywhere it
-- needs to work. updateScreening()'s write is unconditional once a caller
-- passes these fields, so the write itself will error until this runs —
-- every write path wraps it appropriately (see lib/screenings.ts).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE screenings ADD COLUMN IF NOT EXISTS blacklisted boolean NOT NULL DEFAULT false;
ALTER TABLE screenings ADD COLUMN IF NOT EXISTS blacklist_reason text;

-- Partial index, added 2026-07-31 during a full database audit — matches the
-- same pattern already used for duplicate_flag/history_alert_type/batch_id
-- (see their own migrations): listBlacklist() runs a `WHERE blacklisted =
-- true` scan on EVERY pre-screen check-existing call (i.e. every time a
-- recruiter uploads resumes to screen, not just occasionally), so this is a
-- hot path worth indexing from the start rather than adding it later once
-- the table is large.
CREATE INDEX IF NOT EXISTS screenings_blacklisted_idx ON screenings(blacklisted) WHERE blacklisted = true;
