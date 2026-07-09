-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Multi-user support
-- Run this in Supabase SQL editor → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add user_id column to the three main tables
ALTER TABLE screenings          ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE projects            ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE calibration_examples ADD COLUMN IF NOT EXISTS user_id uuid;

-- 2. Indexes for filtering performance
CREATE INDEX IF NOT EXISTS screenings_user_id_idx            ON screenings(user_id);
CREATE INDEX IF NOT EXISTS projects_user_id_idx              ON projects(user_id);
CREATE INDEX IF NOT EXISTS calibration_examples_user_id_idx  ON calibration_examples(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- After running this migration:
--
-- 1. Log in to HireView at /login (sign up at Supabase Dashboard → Auth → Users
--    → Add user, set role: admin in app_metadata).
--
-- 2. After creating your admin account, copy your user UUID from the Auth tab,
--    then run the data migration below (replace YOUR_USER_ID):
-- ─────────────────────────────────────────────────────────────────────────────

-- DATA MIGRATION (run separately once you have your user UUID):
-- UPDATE screenings            SET user_id = 'YOUR_USER_ID' WHERE user_id IS NULL;
-- UPDATE projects              SET user_id = 'YOUR_USER_ID' WHERE user_id IS NULL;
-- UPDATE calibration_examples  SET user_id = 'YOUR_USER_ID' WHERE user_id IS NULL;
