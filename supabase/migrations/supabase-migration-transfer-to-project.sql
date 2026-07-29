-- Vlad's ask, 2026-07-29: "add an option to transfer the candidate to
-- another project from the status dropdown." The "transferred" status
-- VALUE itself needs NO migration at all — screenings.status is a plain
-- `text` column (see bootstrap-core-tables.sql), not a strict Postgres
-- enum, so a new application-level status string is free.
--
-- These two columns are the only genuinely new thing: a pointer from a
-- transferred screening to where it went (the destination project, and the
-- specific NEW screening created there via transferScreeningToProject() in
-- lib/screenings.ts).
--
-- Deliberately kept OUT of the shared SCREENING_COLUMNS select in
-- lib/screenings.ts — same [[feedback_migration_sequencing]] safety rule
-- already applied to batch_id (see supabase-migration-batch-id.sql): two
-- real outages (2026-07-09, 2026-07-10) came from adding a column to that
-- shared select before its migration was confirmed run. These two columns
-- are fetched instead via a separate, isolated enrichment query
-- (enrichTransferInfo in lib/screenings.ts) that degrades gracefully — logs
-- and returns records unenriched — if this migration hasn't run yet, so the
-- main Pipeline/All Candidates read path is never at risk regardless of
-- migration timing.
ALTER TABLE screenings ADD COLUMN IF NOT EXISTS transferred_to_project_id integer;
ALTER TABLE screenings ADD COLUMN IF NOT EXISTS transferred_to_screening_id integer;

CREATE INDEX IF NOT EXISTS screenings_transferred_to_project_id_idx
  ON screenings(transferred_to_project_id)
  WHERE transferred_to_project_id IS NOT NULL;
