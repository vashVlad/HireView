-- Migration: add 'transferred' to screenings.status check constraint
-- Run this in Supabase Dashboard → SQL Editor
--
-- Real bug found 2026-07-29: Vlad tested the Transfer feature and got
-- "new row for relation \"screenings\" violates check constraint
-- \"screenings_status_check\"" — this table has a CHECK constraint
-- restricting `status` to a fixed value list (not a Postgres enum type,
-- but functionally the same restriction — this constraint predates this
-- repo's migration-file convention, likely added directly via the
-- Supabase dashboard, so there was no local migration file to grep for
-- when the Transfer feature was built). The comment in
-- supabase-migration-backfill-interview-status.sql saying "status is
-- already a plain text column... doesn't require a schema change" was
-- correct about the column TYPE but missed this separate constraint —
-- adding a new CandidateStatus value in lib/types.ts alone was never
-- actually enough.
--
-- 'interview' is deliberately NOT in the list below — it was fully
-- backfilled to 'screening' by supabase-migration-backfill-interview-status.sql
-- (2026-07-15, confirmed run) and removed from CandidateStatus the same
-- day; no row should hold it anymore. If this migration fails because some
-- row still has status='interview', run that backfill first.

ALTER TABLE public.screenings
  DROP CONSTRAINT IF EXISTS screenings_status_check;

ALTER TABLE public.screenings
  ADD CONSTRAINT screenings_status_check
  CHECK (status IN ('new_applicant', 'recruiter_screen', 'contacted', 'screening', 'archived', 'transferred'));
