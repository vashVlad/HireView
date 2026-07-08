-- screening_batches: one row per screening run
-- Tracks ALL resumes processed (including below-threshold rejections)
-- so analytics can report true totals without storing individual rejected records.
--
-- Run in Supabase SQL editor: Dashboard → SQL editor → New query

CREATE TABLE IF NOT EXISTS screening_batches (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid references auth.users(id) on delete set null,
  project_id  bigint references projects(id) on delete set null,
  total_count int not null default 0,   -- all resumes processed (passed + rejected)
  passed_count int not null default 0,  -- resumes that met the score threshold
  scores      int[] not null default '{}'  -- every score including rejected ones
);

CREATE INDEX IF NOT EXISTS screening_batches_user_id_idx    ON screening_batches(user_id);
CREATE INDEX IF NOT EXISTS screening_batches_project_id_idx ON screening_batches(project_id);
CREATE INDEX IF NOT EXISTS screening_batches_created_at_idx ON screening_batches(created_at);
