-- Migration: add 'archived' to projects.status check constraint
-- Run this in Supabase Dashboard → SQL Editor

-- Drop the old constraint (only allowed 'active' and 'closed')
ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS projects_status_check;

-- Re-add it with 'archived' included
ALTER TABLE public.projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('active', 'closed', 'archived'));
