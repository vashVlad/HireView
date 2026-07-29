-- One-off data backfill — NOT part of the ordered supabase-migration-*.sql
-- sequence (deliberately named without that prefix so it's never mistaken
-- for a schema migration a fresh DB setup needs to run). Written 2026-07-29,
-- found during a system-wide health audit ahead of scaling to multiple
-- teams ("it has to work like a clock").
--
-- ROOT CAUSE: same denormalization gap as
-- one-off-backfill-null-team-id-from-project.sql (screenings.team_id),
-- just on a sibling table. resume_fingerprints.team_id is denormalized from
-- its screening at save time (lib/screenings.ts's saveFingerprint call), but
-- 50 rows predate that denormalization being reliably populated — all
-- created 2026-07-09 through 2026-07-15, the same Teams-rollout window as
-- the screenings gap. This matters specifically for Phase 1.4's
-- cross-project fraud/history-alert matching (findCrossProjectMatch,
-- lib/resumeFingerprints.ts), which filters with
-- .eq("team_id", teamId) — Postgres's = never matches NULL, so these 50
-- fingerprints are silently invisible to cross-project "Previously seen" /
-- "Known fraud pattern" matching today, not just in some future multi-team
-- scenario. All 50 are in project_id=1 (Forward Deployed Engineer).
--
-- SAFE AND UNAMBIGUOUS: confirmed via direct query that every one of these
-- 50 rows' OWN parent screening (via screening_id) already has a correct,
-- non-null team_id (screenings.team_id was already fully backfilled by the
-- companion script above — 0 nulls there as of this write), and none of the
-- 50 have a project_id that disagrees with their parent screening's
-- project_id. So backfilling from the parent screening (not from the
-- project directly) is the more precise source of truth here and has zero
-- ambiguous cases to resolve.

-- ── Step 1: preview exactly what will change ────────────────────────────────
-- Row count of fingerprints with a NULL team_id whose parent screening has a
-- real team_id. Compare to what you expect (50 as of this write).

select count(*) as fingerprints_to_backfill
from resume_fingerprints rf
join screenings s on s.id = rf.screening_id
where rf.team_id is null
  and s.team_id is not null;

-- Any fingerprint that WON'T be touched by Step 2 below (its own screening
-- also has no team_id, or the screening is gone). Should be empty.

select rf.id, rf.screening_id, rf.project_id, rf.created_at
from resume_fingerprints rf
left join screenings s on s.id = rf.screening_id
where rf.team_id is null
  and (s.id is null or s.team_id is null);

-- ── Step 2: the actual backfill ──────────────────────────────────────────────
-- Wrapped in a transaction so you can inspect the result with the
-- verification query below BEFORE committing. Idempotent by construction —
-- once a row's team_id is set, the WHERE clause no longer matches it.

begin;

update resume_fingerprints rf
set team_id = s.team_id
from screenings s
where rf.screening_id = s.id
  and rf.team_id is null
  and s.team_id is not null;

-- ── Step 3: verify BEFORE committing ────────────────────────────────────────
-- remaining_null should be 0 (or only cover rows whose screening is itself
-- team-less, per Step 1's second query).

select count(*) as remaining_null from resume_fingerprints where team_id is null;

-- If the number above looks right: commit.
commit;

-- If anything looked wrong instead, run this before the commit line above:
-- rollback;
