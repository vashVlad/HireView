-- One-off fix, 2026-08-17 — rebuilds the `screenings_embedding_idx` ivfflat
-- index in place, live-database only (does not modify supabase-migration-
-- candidate-embeddings.sql's own history — see that file's own comment on
-- the same index for the full root-cause explanation, bugs #1 and #2).
--
-- Why this is needed right now: `supabase-migration-candidate-embeddings.sql`
-- was run while `screenings.embedding` was 100% NULL, so the ivfflat index
-- was built with zero real vectors to cluster against and came out
-- degenerate — confirmed directly (2026-08-17): after backfilling 2 real
-- candidates with real Voyage embeddings, match_screenings_by_embedding
-- returned an EMPTY array for both a dummy vector and two real semantic
-- queries, despite the function having no similarity threshold and both
-- rows genuinely having non-null embeddings. The search feature is
-- currently non-functional (0% recall) until this runs.
--
-- A first attempt at running `reindex index screenings_embedding_idx;`
-- directly against the live database failed with:
--   ERROR: 54000: memory required is 41 MB, maintenance_work_mem is 32 MB
-- Root cause: the original `lists = 100` was oversized for this repo's real
-- data volume (Supabase's own pgvector guidance is roughly sqrt(row_count),
-- and sqrt(~400) ≈ 20) — building that many lists against a live table
-- pushed past Supabase's default maintenance_work_mem. Fixed two ways at
-- once below: a session-level maintenance_work_mem bump (safe, temporary,
-- scoped to just this SQL editor run — does not require superuser or
-- change any persistent server config) AND dropping/rebuilding the index
-- at the smaller, better-calibrated lists=20 that
-- supabase-migration-candidate-embeddings.sql now specifies.
--
-- Run this in the Supabase SQL editor:
--   1. Immediately, to make the 2 already-backfilled test rows
--      (Ernesto Macias #412, Gautam Bhattacharya #449) searchable right away.
--   2. REQUIRED again after scripts/backfill-candidate-embeddings.ts finishes
--      populating the remaining ~395 pre-existing screenings — an index
--      rebuilt against only 2 rows is still a poor approximation of the real
--      distribution. Safe to run as many times as needed; each run just
--      rebuilds from whatever data exists at that moment.

set maintenance_work_mem = '64MB';

drop index if exists screenings_embedding_idx;
create index screenings_embedding_idx
  on screenings using ivfflat (embedding vector_cosine_ops)
  with (lists = 20);

analyze screenings;
