-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: current_company / current_title / total_experience_summary /
--            linkedin_url on screenings
-- Run this in Supabase SQL editor → Run
--
-- Backs the FunnelView Excel export's "Current Company" / "Current Title" /
-- "Total experience" / "LinkedIn" columns (Vlad's ask, 2026-08-04, LinkedIn
-- added 2026-08-06). Populated via lib/generateTrajectory.ts (the
-- "Regenerate trajectories" backfill path for already-screened candidates)
-- AND, as of 2026-08-06, lib/scoreCandidate.ts itself (do-not-touch
-- exception, Vlad's explicit sign-off — see that file's own comment) so
-- NEW screenings get all four automatically going forward, no manual
-- backfill needed. Written only through updateScreening(), as a separate
-- best-effort call in both paths — NOT added to the shared SCREENING_COLUMNS
-- read path, so nothing breaks pre-migration (same deferred pattern as
-- archive_reason/blacklisted/suggested_role_fits).
--
-- total_experience_summary is deliberately its OWN short field, not derived
-- from career_trajectory — that column's own format (2-3 sentences per role
-- + a closing recommendation paragraph) is an established, separately-tuned
-- design used on-screen elsewhere and stays untouched.
--
-- linkedin_url is frequently NULL even for fully-processed candidates —
-- not every resume lists one. The "Regenerate trajectories" backfill
-- deliberately does NOT treat a null linkedin_url as "still needs
-- reprocessing" (see lib/screenings.ts's getCurrentRoleStatus comment),
-- unlike the other three columns.
--
-- REAL INCIDENT, 2026-08-06: earlier code read current_company/
-- current_title/total_experience_summary as ONE bundled query. Once this
-- migration lagged behind the code (total_experience_summary added to code
-- before this file was re-run), that bundled query failed outright and
-- wiped out current_company/current_title too — even though those two
-- already existed and were populated. Fixed in lib/funnelview/data.ts by
-- making each column an independent, isolated fetch. Doesn't change what
-- this migration needs to do, but it's why re-running this file promptly
-- after it changes matters — the code degrades gracefully per-column now,
-- but real data (like the "Current Company" export column) stays genuinely
-- blank until the column actually exists.
--
-- Existing screenings will have NULL here until backfilled — run this
-- migration first, then use the "Regenerate trajectories" button in a
-- project's Settings tab to backfill that role's already-screened candidates
-- (it only checks current_company/current_title/total_experience_summary
-- for "still needs it" — not linkedin_url, see above — so it's safe to
-- click more than once; already-backfilled candidates are skipped).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS current_company text;

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS current_title text;

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS total_experience_summary text;

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS linkedin_url text;
