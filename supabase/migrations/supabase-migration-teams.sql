-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Teams Architecture (Phase 1.3)
-- Run this in Supabase SQL editor → Run
--
-- Admin → Team → Projects → Users. A recruiter sees only projects (and their
-- candidates) belonging to a team they're a member of. Admin sees everything,
-- regardless of team.
--
-- team_id is stored on both `projects` (source of truth) and `screenings`
-- (denormalized at save time from the project) so the hot-path list queries
-- can filter with a plain `.eq`/`.in` instead of a join.
--
-- Zero data loss: every existing user is added to a new "General" team, and
-- every existing project/screening with no team is backfilled into it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teams (
  id         bigserial primary key,
  name       text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  id         bigserial primary key,
  team_id    bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS team_members_user_id_idx ON team_members(user_id);
CREATE INDEX IF NOT EXISTS team_members_team_id_idx ON team_members(team_id);

ALTER TABLE projects   ADD COLUMN IF NOT EXISTS team_id bigint REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE screenings ADD COLUMN IF NOT EXISTS team_id bigint REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projects_team_id_idx ON projects(team_id);
CREATE INDEX IF NOT EXISTS screenings_team_id_idx ON screenings(team_id);

-- Backfill: default "General" team, every existing user added as a member,
-- every existing project/screening assigned to it.
DO $$
DECLARE
  general_team_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM teams WHERE name = 'General') THEN
    INSERT INTO teams (name) VALUES ('General') RETURNING id INTO general_team_id;
  ELSE
    SELECT id INTO general_team_id FROM teams WHERE name = 'General' LIMIT 1;
  END IF;

  INSERT INTO team_members (team_id, user_id)
  SELECT general_team_id, id FROM auth.users
  ON CONFLICT (team_id, user_id) DO NOTHING;

  UPDATE projects SET team_id = general_team_id WHERE team_id IS NULL;
  UPDATE screenings SET team_id = general_team_id WHERE team_id IS NULL;
END $$;
