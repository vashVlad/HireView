-- Projects feature migration
-- Run this in your Supabase SQL editor

-- 1. Create projects table
CREATE TABLE IF NOT EXISTS projects (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  job_description text NOT NULL,
  jd_analysis jsonb,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. Add project_id to screenings (nullable for backward compat with existing rows)
ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS project_id integer REFERENCES projects(id) ON DELETE SET NULL;

-- 3. Index for fast project filtering
CREATE INDEX IF NOT EXISTS screenings_project_id_idx ON screenings(project_id);
