-- "Referred" source type, 2026-08-26 (Vlad's ask) — mirrors agency_name's
-- purpose exactly (a name captured alongside the source classification) but
-- for a person who referred the candidate rather than an agency.
--
-- UNLIKE agency_name (added 2026-07-20, wired unconditionally into every
-- saveScreening() INSERT before the deferred-column convention existed),
-- this column follows the now-established safer pattern: it is read via an
-- isolated attachReferrerNames() fetch and written via saveScreening()'s
-- best-effort updateScreening() call, not the main INSERT. This migration
-- does NOT need to be confirmed run before deploy — a pre-migration
-- environment just silently skips this field (screening still saves fine)
-- until this is run. See lib/screenings.ts's attachLinkedinUrls/
-- attachGithubSignals for the pattern this mirrors, and lib/types.ts's
-- ScreeningRecord.referrerName doc comment for the full rationale.

ALTER TABLE screenings ADD COLUMN IF NOT EXISTS referrer_name text;
