-- One-off data reassignment — NOT part of the ordered supabase-migration-*.sql
-- sequence in docs/Cirot-Database-Migration-Runbook.md (deliberately named
-- without that prefix so it's never mistaken for a schema migration a fresh
-- DB setup needs to run). Written 2026-07-27 per Vlad's ask: "move all of the
-- candidates from test@brillio.com and put them under
-- tetiana.nytsyk@brillio.com."
--
-- WHY THIS EXISTS AS A SCRIPT, NOT AN AUTOMATED CHANGE:
-- This sandbox has no live Supabase/network access (a standing limitation —
-- see memory/state.md), and this is a destructive write against real Brillio
-- pilot production data. Run this yourself in the Supabase SQL editor (or
-- hand it to Claude Code, which has real DB access) — do NOT run it
-- unattended. Read the whole file first; it's built to make you look before
-- anything commits.
--
-- SCOPE: only screenings.user_id (i.e. "who does this candidate/screening
-- belong to") is reassigned. Deliberately NOT touched:
--   - screening_actions.user_id (the attribution/audit timeline) — that's a
--     historical record of who actually clicked what; rewriting it would
--     misattribute real past actions to someone who didn't take them.
--   - projects.user_id / calibration_examples.user_id — Vlad's ask was about
--     "candidates" specifically. If test@brillio.com also owns projects or
--     calibration examples that should move too, that's a separate,
--     deliberate decision — flag it and this script can be extended.
-- If either of those turns out to matter, stop and ask before broadening scope.
--
-- ── Step 1: resolve both accounts, and confirm the counts you expect ───────
-- Run this SELECT first, on its own, before touching anything. It should
-- return exactly one row per email. If either email returns zero rows or more
-- than one, STOP — do not proceed until you know why.

select id, email
from auth.users
where email in ('test@brillio.com', 'tetiana.nytsyk@brillio.com');

-- ── Step 2: preview exactly what will change ────────────────────────────────
-- Row count of screenings currently attributed to test@brillio.com. Compare
-- this to what you expect before running the UPDATE below.

select count(*) as screenings_to_reassign
from screenings s
join auth.users u on u.id = s.user_id
where u.email = 'test@brillio.com';

-- Optional: eyeball the actual candidates before committing to the change.

select s.id, s.candidate_name, s.project_id, s.status, s.created_at
from screenings s
join auth.users u on u.id = s.user_id
where u.email = 'test@brillio.com'
order by s.created_at desc;

-- ── Step 3: the actual reassignment ─────────────────────────────────────────
-- Wrapped in a transaction so you can inspect the result with the verification
-- query below BEFORE committing. If anything looks wrong, run ROLLBACK
-- instead of COMMIT and nothing will have changed.
--
-- Idempotent by construction: once these rows' user_id is switched to
-- tetiana's id, the WHERE clause (still keyed off test@brillio.com's id) no
-- longer matches them — running this a second time is a safe no-op, not a
-- double-move.

begin;

update screenings
set user_id = (select id from auth.users where email = 'tetiana.nytsyk@brillio.com')
where user_id = (select id from auth.users where email = 'test@brillio.com');

-- ── Step 4: verify BEFORE committing ────────────────────────────────────────
-- Should now show 0 remaining under test@brillio.com, and tetiana's count
-- should have grown by exactly the number from Step 2.

select
  (select count(*) from screenings s join auth.users u on u.id = s.user_id where u.email = 'test@brillio.com') as remaining_under_test,
  (select count(*) from screenings s join auth.users u on u.id = s.user_id where u.email = 'tetiana.nytsyk@brillio.com') as now_under_tetiana;

-- If the numbers above look right: commit.
commit;

-- If anything looked wrong instead, run this before the commit line above:
-- rollback;
