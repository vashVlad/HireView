-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: current_company / current_title on screenings
-- Run this in Supabase SQL editor → Run
--
-- Backs the FunnelView Excel export's "Current Company" / "Current Title"
-- columns (Vlad's ask, 2026-08-04). Populated via lib/generateTrajectory.ts
-- (extended alongside careerTrajectory extraction, same Claude call — no
-- extra API cost), written only through updateScreening() — NOT added to
-- the shared SCREENING_COLUMNS read path, so nothing breaks pre-migration
-- (same deferred pattern as archive_reason/blacklisted/suggested_role_fits).
--
-- Existing screenings will have NULL here until backfilled — run this
-- migration first, then use the "Regenerate trajectories" button in a
-- project's Settings tab to backfill that role's already-screened candidates.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS current_company text;

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS current_title text;
