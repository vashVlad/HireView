-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: current_company / current_title / total_experience_summary on screenings
-- Run this in Supabase SQL editor → Run
--
-- Backs the FunnelView Excel export's "Current Company" / "Current Title" /
-- "Total experience" columns (Vlad's ask, 2026-08-04). Populated via
-- lib/generateTrajectory.ts (extended alongside careerTrajectory extraction,
-- same Claude call — no extra API cost), written only through
-- updateScreening() — NOT added to the shared SCREENING_COLUMNS read path,
-- so nothing breaks pre-migration (same deferred pattern as
-- archive_reason/blacklisted/suggested_role_fits).
--
-- total_experience_summary is deliberately its OWN short field, not derived
-- from career_trajectory — that column's own format (2-3 sentences per role
-- + a closing recommendation paragraph) is an established, separately-tuned
-- design used on-screen elsewhere and stays untouched.
--
-- Existing screenings will have NULL here until backfilled — run this
-- migration first, then use the "Regenerate trajectories" button in a
-- project's Settings tab to backfill that role's already-screened candidates
-- (it only processes candidates missing current_company/current_title, so
-- it's safe to click more than once — already-backfilled candidates are skipped).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS current_company text;

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS current_title text;

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS total_experience_summary text;
