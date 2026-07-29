-- One-off data backfill — NOT part of the ordered supabase-migration-*.sql
-- sequence in docs/HireView-Database-Migration-Runbook.md (deliberately named
-- without that prefix so it's never mistaken for a schema migration a fresh
-- DB setup needs to run). Written 2026-07-29 per Vlad's ask: "make sure it's
-- just same visible for both recruiter and admin" — a recruiter on the FDE
-- project (project_id=1) could only see 110 of 224 real candidates in the
-- Pipeline tab, while an admin viewing the same project saw all 224.
--
-- ROOT CAUSE (confirmed via direct query, not guessed): Pipeline visibility
-- is team-scoped — GET /api/history resolves teamIdsFilter(user) for a
-- recruiter and calls listScreenings(..., teamIds), which does
-- .in("team_id", teamIds). Postgres's IN() never matches NULL. Admins get
-- teamIdsFilter() === undefined (no filter at all), so they see every row
-- regardless of team_id. Confirmed: FDE (project_id=1) has 224 screenings —
-- 110 with team_id=4 (correct) and 114 with team_id=NULL (orphaned). All 114
-- orphaned rows were created 2026-06-23 through 2026-07-15 — before/during
-- the Teams architecture rollout (Phase 1.3 shipped 2026-07-09, which started
-- denormalizing team_id onto screenings going forward) — every row from
-- 2026-07-16 onward already has team_id=4 correctly. This is the exact
-- team_id backfill flagged as "unclear if it actually got run" in
-- memory/open-questions.md back on 2026-07-09/10, apparently never finished.
--
-- SCOPE: system-wide, not just FDE — 116 total orphaned rows as of this
-- write (114 in project_id=1, 2 in project_id=4 "Data AI Architect -
-- Banking/California"). Every screening's team_id should always match its
-- own project's team_id (that's the invariant lib/screenings.ts's
-- saveScreening() already maintains going forward via denormalization) — so
-- backfilling from each row's own project is safe and unambiguous, not a
-- guess. Only screenings.team_id is touched. Not touched: resume_fingerprints
-- .team_id (same denormalization exists there per Phase 1.4 — check
-- separately if fingerprint-based matching also seems to be missing rows for
-- a recruiter; out of scope for this specific visibility bug).
--
-- WHY THIS EXISTS AS A SCRIPT, NOT AN AUTOMATED CHANGE: this is a write
-- against real Brillio pilot production data — run it yourself in the
-- Supabase SQL editor. Read the whole file first; it's built to make you
-- look before anything commits.

-- ── Step 1: preview exactly what will change ────────────────────────────────
-- Row count of screenings with a NULL team_id but a real, team-owned project.
-- Compare this to what you expect (116 as of this write) before proceeding.

select count(*) as screenings_to_backfill
from screenings s
join projects p on p.id = s.project_id
where s.team_id is null
  and p.team_id is not null;

-- Breakdown by project, so you can sanity-check against what you know about
-- each role's real candidate count.

select p.id as project_id, p.name as project_name, p.team_id, count(*) as orphaned_rows
from screenings s
join projects p on p.id = s.project_id
where s.team_id is null
  and p.team_id is not null
group by p.id, p.name, p.team_id
order by orphaned_rows desc;

-- Any screening left over that WON'T be touched by Step 3 below — either it
-- has no project at all, or its project itself has no team_id. Should be
-- empty or near-empty; if it's not, these rows will stay invisible to every
-- recruiter (admin-only) even after this script runs, and need their own
-- follow-up decision (assign a project, or assign a team directly).

select s.id, s.candidate_name, s.project_id, s.created_at
from screenings s
left join projects p on p.id = s.project_id
where s.team_id is null
  and (s.project_id is null or p.team_id is null)
order by s.created_at desc;

-- ── Step 2: the actual backfill ──────────────────────────────────────────────
-- Wrapped in a transaction so you can inspect the result with the
-- verification query below BEFORE committing. If anything looks wrong, run
-- ROLLBACK instead of COMMIT and nothing will have changed.
--
-- Idempotent by construction: once a row's team_id is set, the WHERE clause
-- (team_id is null) no longer matches it — running this a second time is a
-- safe no-op, not a double-write.

begin;

update screenings s
set team_id = p.team_id
from projects p
where s.project_id = p.id
  and s.team_id is null
  and p.team_id is not null;

-- ── Step 3: verify BEFORE committing ────────────────────────────────────────
-- remaining_null should now only count rows with no project or a team-less
-- project (see Step 1's third query) — ideally 0. fde_total/fde_visible_all
-- should be equal (224/224), matching what admin already sees.

select
  (select count(*) from screenings where team_id is null) as remaining_null,
  (select count(*) from screenings where project_id = 1) as fde_total,
  (select count(*) from screenings where project_id = 1 and team_id = 4) as fde_visible_to_team4;

-- If the numbers above look right: commit.
commit;

-- If anything looked wrong instead, run this before the commit line above:
-- rollback;
