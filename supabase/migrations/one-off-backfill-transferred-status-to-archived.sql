-- One-off data backfill — NOT part of the ordered supabase-migration-*.sql
-- sequence in docs/HireView-Database-Migration-Runbook.md (deliberately named
-- without that prefix so it's never mistaken for a schema migration a fresh
-- DB setup needs to run). Written 2026-08-02 per Vlad's ask: "I don't want
-- to show the transferred status of the candidate in the status dropdown
-- since i want to archive the candidate of that project that was
-- transferred."
--
-- Going forward, transferScreeningToProject() (lib/screenings.ts) now sets
-- the ORIGINAL screening's status to "archived" with archive_reason
-- "Transferred" instead of status "transferred" — see lib/types.ts's
-- CandidateStatus comment for the full story. This script is the one-time
-- cleanup for any row already written before that code change deployed.
--
-- SCOPE: only screenings.status and screenings.archive_reason are touched.
-- transferred_to_project_id/transferred_to_screening_id are left exactly as
-- they are — those columns are independent of status and already power the
-- "view destination" link regardless of which status value a row has.
-- archive_reason is only set when it's currently empty, so a row someone
-- already manually gave a different archive reason to (unlikely, but
-- possible if this was hand-edited) is never overwritten.
--
-- WHY THIS EXISTS AS A SCRIPT, NOT AN AUTOMATED CHANGE: this is a write
-- against real pilot production data — run it yourself in the Supabase SQL
-- editor. Read the whole file first; it's built to make you look before
-- anything commits. Low urgency — likely 0 or very few rows given the
-- Transfer feature only shipped a few days before this fix, but worth
-- running once so no stale "Transferred" status lingers in the dropdown.

-- ── Step 1: preview exactly what will change ────────────────────────────────

select id, candidate_name, project_id, archive_reason, status_updated_at
from screenings
where status = 'transferred'
order by status_updated_at desc;

-- ── Step 2: the actual backfill ──────────────────────────────────────────────
-- Wrapped in a transaction so you can inspect the result with the
-- verification query below BEFORE committing. If anything looks wrong, run
-- ROLLBACK instead of COMMIT and nothing will have changed.
--
-- Idempotent by construction: once a row's status is 'archived', the WHERE
-- clause (status = 'transferred') no longer matches it.

begin;

update screenings
set status = 'archived',
    archive_reason = coalesce(nullif(archive_reason, ''), 'Transferred')
where status = 'transferred';

-- ── Step 3: verify BEFORE committing ────────────────────────────────────────
-- remaining_transferred should now be 0.

select
  (select count(*) from screenings where status = 'transferred') as remaining_transferred,
  (select count(*) from screenings where status = 'archived' and archive_reason = 'Transferred') as now_archived_as_transferred;

-- If the numbers above look right: commit.
commit;

-- If anything looked wrong instead, run this before the commit line above:
-- rollback;
