-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Screening batch id — durable "come back to this batch" page
-- Run this in Supabase SQL editor → Run
--
-- Every candidate is already saved regardless of score (2026-07-10, Save-All),
-- so the underlying data was never the problem — there was no way to ask
-- "which specific screenings were part of the batch I ran a moment ago."
-- batch_id is a plain client-generated UUID (crypto.randomUUID(), see
-- app/api/screen-resumes/route.ts), the same value written onto every
-- screening saved in one POST /api/screen-resumes call. Deliberately a
-- lightweight `text` column, not a foreign key into screening_batches (that
-- table only ever stored aggregate stats for Analytics — total_count,
-- passed_count, a bare scores[] array — never individual screening ids, so
-- there was nothing there to join against).
--
-- Vlad's ask, 2026-07-28: sessionStorage (the first attempt at "let me get
-- back to the results I just screened") only lives in one browser tab, which
-- doesn't hold up for a recruiter who explicitly works across two machines
-- (see CLAUDE.md's "why Cirot is web-hosted, not local") — a real,
-- bookmarkable, cross-device URL needs to be backed by the database, not
-- browser storage.
--
-- Additive only, no backfill: only applies going forward, same approach as
-- every other signal column added this project. Old screenings simply have
-- batch_id = NULL and were never part of a "come back to this batch" link.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE screenings ADD COLUMN IF NOT EXISTS batch_id text;

CREATE INDEX IF NOT EXISTS screenings_batch_id_idx ON screenings(batch_id) WHERE batch_id IS NOT NULL;
