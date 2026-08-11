-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: target_company_matches on screenings
-- Run this in Supabase SQL editor → Run
--
-- Backs the "target company score boost" feature (Vlad's ask, 2026-08-07):
-- a recruiter lists companies in the JD Analyzer's "Score boost companies"
-- section (reuses JDAnalysis.wide/narrow.targetCompanies); at screening time
-- a flat +5 point bonus is added to the score if the resume text mentions
-- any of them. See lib/targetCompanyBoost.ts for the matching logic.
--
-- IMPORTANT — this column is NOT required for the boost itself to work. The
-- score adjustment happens entirely in memory (result.score gets the bonus
-- before saveScreening() writes it) and needs no schema change. This column
-- only stores WHICH companies matched, for display later — written via a
-- SEPARATE, best-effort updateScreening() call, never the main saveScreening()
-- insert, specifically so a screening can never fail just because this
-- migration hasn't run yet (same deferred pattern as current_company/
-- current_title — see supabase-migration-current-role.sql and
-- memory/feedback_migration_sequencing.md, 2026-07-09 outage).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS target_company_matches text[];
