# Supabase migrations — what to run, 2026-08-17

Run these in the Supabase SQL editor. Full file contents are already in `supabase/migrations/` — this doc is a status list, not a copy of the SQL, so it stays accurate as files change.

## 1. Required for today's work — run this first

**`supabase-migration-checklist.sql`** — new. Adds `projects.checklist` (jsonb) and `screenings.checklist_evaluation` (jsonb) for the JD checklist feature built this session. Nothing reads or writes either column until this runs; the feature is fully opt-in (a project with no checklist configured screens exactly as before). Safe to run any time, no backfill needed, no downtime.

## 2. Everything else the codebase's own comments still flag as unconfirmed

These predate this session. Per `memory/state.md`/`memory/open-questions.md`'s history, some of these were likely already run and the code comments are just stale (comments don't always get updated after Vlad confirms a migration in chat) — **check the column/table actually exists in Supabase's Table Editor before re-running; every one of these uses `IF NOT EXISTS`, so re-running a real no-op is harmless, but worth confirming rather than assuming either way.**

| Migration | What it adds | Last known status (per project memory) |
|---|---|---|
| `supabase-migration-fraud-calibration.sql` | `fraud_calibration_examples` table + `screenings.fraud_risk` column | Not yet run as of 2026-07-30 |
| `supabase-migration-archive-fits.sql` | `screenings.suggested_role_fits` + `archive_fit_candidates` table | Not yet run as of 2026-07-30 |
| `supabase-migration-current-role.sql` | `screenings.current_company/current_title/total_experience_summary/linkedin_url` | Not yet run as of 2026-08-06 |
| `supabase-migration-target-company-boost.sql` | `screenings.target_company_matches` (display-only — the score boost itself works with no migration) | Not yet run as of 2026-08-07 |
| `supabase-migration-exclude-from-fit-suggestions.sql` | `projects.exclude_from_fit_suggestions` | Status unclear — added 2026-07-30, never explicitly confirmed run in memory |

If any of these are confirmed already run, let a future session know (or update the corresponding "NOT YET CONFIRMED RUN" comment in the code directly) so this list stops re-flagging them.

## 3. One-off / destructive scripts — review before running, do not blind-run

These are one-time data fixes, not additive schema changes — each has its own preview-then-transaction pattern built in (inspect the SELECT output before the COMMIT).

- **`one-off-backfill-null-team-id-resume-fingerprints.sql`** — backfills `team_id` on 50 `resume_fingerprints` rows (all from the same 2026-07-09–07-15 rollout window as an earlier, already-fixed `screenings.team_id` gap). Confirmed safe/unambiguous (every affected row's parent screening already has the correct team_id) — flagged as needing Vlad to run since 2026-07-29, likely still pending.
- **`one-off-reassign-test-brillio-to-tetiana.sql`** — reassigns `screenings.user_id` from `test@brillio.com` to `tetiana.nytsyk@brillio.com`. Deliberately scoped to `screenings` only (not `screening_actions` audit trail or `calibration_examples`) — review the file's header before running, and decide whether `projects`/`calibration_examples` ownership should also move (the original ask was specifically about candidates).
- **`one-off-backfill-transferred-status-to-archived.sql`** — backfills any pre-existing `status = 'transferred'` row to `status = 'archived', archive_reason = 'Transferred'`. Low volume expected (Transfer only shipped a few days before this fix). Flagged 2026-08-02, likely still pending.

## Not a migration — a live-data question, needs checking in the Supabase dashboard directly

**Supabase's project-level `db-max-rows` / PostgREST row-limit setting** — `listScreenings()`'s hardcoded `.limit(200)` was removed 2026-07-27, but nothing in this codebase can confirm whether a separate server-side cap sits underneath it. Check Settings → API in the Supabase dashboard. If there's a cap lower than your actual candidate volume, counts could still silently stall, just at a higher number than 200.

---

*Compiled from `memory/state.md` and `memory/open-questions.md`'s dated entries as of 2026-08-17 — this is a best-effort reconstruction of migration history, not a live database query. If in doubt about any single migration's status, check Supabase's Table Editor directly rather than trusting this list.*
