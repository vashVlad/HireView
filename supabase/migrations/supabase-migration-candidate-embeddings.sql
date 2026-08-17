-- Global talent search, 2026-08-17 (roadmap 2.5.9). First vector/embedding
-- infrastructure in this codebase — enables the `vector` extension (pgvector,
-- available on all Supabase projects by default, no separate enablement
-- request needed), adds a nullable embedding column to `screenings` (NOT
-- folded into the shared SCREENING_COLUMNS select in lib/screenings.ts — see
-- that file's setScreeningEmbedding() comment for why), and a Postgres
-- function for cosine-similarity search via Supabase's .rpc().
--
-- Run this BEFORE deploying the code that reads/writes the `embedding`
-- column (same sequencing rule as every other migration in this repo — see
-- this file's sibling migrations' headers for the incident that rule comes
-- from). Existing screenings will have embedding = null until either
-- re-screened or backfilled via scripts/backfill-candidate-embeddings.ts.
--
-- Vector width (1024) matches lib/embeddings.ts's EMBEDDING_DIMENSION
-- (voyage-3.5's documented default output_dimension) — if that ever changes,
-- this column width has to change with it, they are not independently
-- adjustable.

create extension if not exists vector;

alter table screenings add column if not exists embedding vector(1024);

-- ivfflat, not the newer hnsw, deliberately — this repo's candidate volume
-- (hundreds, not millions of rows) doesn't need hnsw's extra build/memory
-- cost, and ivfflat is the more conservative/widely-supported default.
--
-- REAL BUG #1, found and fixed 2026-08-17 via live verification against the
-- actual database: ivfflat's clustering is computed from whatever rows
-- exist in the table AT THE MOMENT the index is built. On a fresh run of
-- this migration, `embedding` is 100% NULL (see comment above — existing
-- screenings only get one via backfill or a later re-screen), so the index
-- gets built with zero real vectors to cluster against and comes out
-- degenerate. Confirmed directly: after backfilling 2 real candidates with
-- real Voyage embeddings, match_screenings_by_embedding returned an EMPTY
-- array for both a dummy vector and two real semantic queries, despite the
-- function itself having no similarity threshold and both rows genuinely
-- having non-null embeddings — a well-documented pgvector footgun, not a
-- one-off fluke. Fix: `drop index if exists` + plain `create index` (not
-- `if not exists`) so that re-running this file always rebuilds the index
-- from whatever data actually exists at that moment, instead of silently
-- no-op'ing if a (possibly degenerate) index of the same name already
-- exists.
--
-- REAL BUG #2, found the same session while trying to apply bug #1's fix
-- live: `lists = 100` (this file's own original comment called it "a
-- reasonable starting point for low-thousands of rows") was already
-- miscalibrated for this repo's real volume — the same comment cites
-- Supabase's own guidance of roughly sqrt(row_count), and sqrt(~400) ≈ 20,
-- not 100. This wasn't just a quality tradeoff: attempting to build/rebuild
-- the index at lists=100 against the live database failed outright with
-- `ERROR: 54000: memory required is 41 MB, maintenance_work_mem is 32 MB`
-- — Supabase's default maintenance_work_mem is too low for an
-- oversized-for-the-data lists value. Lowered to 20 (revisit again, same
-- sqrt(row_count) rule, once the candidate pool is an order of magnitude
-- larger than it is today).
--
-- THIS MIGRATION MUST BE RE-RUN (or `reindex index
-- screenings_embedding_idx;` run directly) AFTER
-- scripts/backfill-candidate-embeddings.ts finishes — running it again
-- immediately after this fix, before any real data exists, would just
-- recreate a still-degenerate (if smaller) index. See the sibling
-- one-off-reindex-screenings-embedding.sql for a standalone fix that
-- doesn't require re-running the whole file.
drop index if exists screenings_embedding_idx;
create index screenings_embedding_idx
  on screenings using ivfflat (embedding vector_cosine_ops)
  with (lists = 20);

-- Cosine similarity search, callable via supabase.rpc('match_screenings_by_embedding', {...})
-- from lib/candidateSearch.ts. Optional project/team filters so a search can
-- be scoped the same way the rest of the app already scopes reads (team_id
-- for multi-tenant isolation, project_id for "search within this role").
-- security definer intentionally NOT used — runs with the caller's own
-- privileges via the service-role key this app already uses for every other
-- query (see lib/supabase.ts), consistent with the rest of this schema
-- having no RLS policies of its own (see docs/Cirot-Database-Migration-Runbook.md).
create or replace function match_screenings_by_embedding(
  query_embedding vector(1024),
  match_count int default 20,
  filter_team_ids int[] default null,
  filter_project_id int default null
)
returns table (id int, similarity float)
language sql stable
as $$
  select
    screenings.id,
    1 - (screenings.embedding <=> query_embedding) as similarity
  from screenings
  where screenings.embedding is not null
    and (filter_team_ids is null or screenings.team_id = any(filter_team_ids))
    and (filter_project_id is null or screenings.project_id = filter_project_id)
  order by screenings.embedding <=> query_embedding
  limit match_count;
$$;
