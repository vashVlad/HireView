-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Configurable score threshold per project (Task 4)
-- Run this in Supabase SQL editor → Run
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS score_threshold integer NOT NULL DEFAULT 45;

-- All existing projects inherit the current global default (45).
-- Recruiters can override this per-role in the project Settings tab.
