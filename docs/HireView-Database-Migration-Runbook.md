# HireView — Database Migration Runbook

*Written 2026-07-23 as part of database migration readiness for the Brillio enterprise pilot. Goal: any DBA unfamiliar with this codebase should be able to stand up a working HireView database from scratch using only this document, in well under two hours.*

## 1. What you're standing up

HireView uses Supabase (hosted Postgres + Auth + Storage) as its only datastore. There is no ORM — every query goes through the `@supabase/supabase-js` client, either with the service-role key (server-side, bypasses RLS — see §5) or the anon key (browser-side, Auth session handling only, never data reads/writes).

The schema is **22 SQL files**, all in `supabase/migrations/`, run once each, in order, in the Supabase SQL editor (or any Postgres client pointed at the instance). All 22 are idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc.) — safe to re-run if you're ever unsure whether one already ran.

## 2. Prerequisites

- A Supabase project (or any Postgres 14+ instance if not using Supabase's hosted product — see §6 for what you'd lose).
- Access to that project's SQL editor, or a Postgres client with a connection string.
- Access to that project's Storage and Auth settings (Supabase dashboard, or equivalent API/CLI access).

## 3. Run the migrations, in this exact order

Three tables (`screenings`, `tracker`, `calibration_examples`) predate this project's migration-file convention and were originally created by hand in the dashboard — `bootstrap-core-tables.sql` (new, written alongside this runbook) reconstructs them from the app's actual TypeScript row shapes so this order works on a genuinely empty database. Every other table has a real `CREATE TABLE` in its own file.

Run each of these once, top to bottom, in the Supabase SQL editor:

1. `bootstrap-core-tables.sql` — creates `screenings`, `tracker`, `calibration_examples` in their current, final shape.
2. `supabase-migration-projects.sql` — creates `projects`; adds `project_id` FK to `screenings`.
3. `supabase-migration-linkedin-mode.sql` — adds `linkedin_mode` to `screenings`.
4. `supabase-migration-interview.sql` — adds `interview_questions`, `linkedin_pdf_path`, `photo_url` to `screenings`.
5. `supabase-migration-multiuser.sql` — adds `user_id` to `screenings`/`projects`/`calibration_examples`.
6. `supabase-migration-teams.sql` — creates `teams`, `team_members`; adds `team_id` to `projects`/`screenings`; backfills a default "General" team.
7. `supabase-migration-batches.sql` — creates `screening_batches` (references `projects`).
8. `supabase-migration-threshold.sql` — adds `score_threshold` to `projects`.
9. `supabase-migration-fingerprints.sql` — creates `resume_fingerprints` (references `screenings`/`projects`); adds `duplicate_flag`/`duplicate_match_id` to `screenings`.
10. `supabase-migration-history-alert.sql` — adds `team_id` to `resume_fingerprints` (needs `teams` from step 6); adds `history_alert_type`/`history_alert_match_id` to `screenings`.
11. `supabase-migration-screening-actions.sql` — creates `screening_actions` (references `screenings`).
12. `supabase-migration-backfill-interview-status.sql` — data-only backfill, no schema change (harmless no-op on a fresh DB with no rows).
13. `supabase-migration-reject-reason.sql` — adds `reject_reason` to `tracker`.
14. `supabase-migration-resume-content-hash.sql` — adds `resume_content_hash` to `screenings`.
15. `supabase-migration-name-match.sql` — adds `name_match_id` to `screenings`.
16. `supabase-migration-previous-status.sql` — adds `previous_status`/`previous_stage`; **creates two triggers** (see §4).
17. `supabase-migration-archive-reason.sql` — adds `archive_reason` to `screenings`.
18. `supabase-migration-tracker-location.sql` — adds `location` to `tracker`.
19. `supabase-migration-status-archived.sql` — widens `projects.status`'s CHECK constraint to include `'archived'`.
20. `supabase-migration-access-requests.sql` — creates `access_requests` (standalone, RLS disabled).
21. `supabase-migration-feedback.sql` — creates `feedback` (standalone, RLS disabled).
22. `supabase-migration-agency-source.sql` — adds `agency_name` to `screenings`.

Because every statement is guarded (`IF NOT EXISTS`), running these against `bootstrap-core-tables.sql`'s already-complete table shapes just results in a lot of harmless no-ops for the `ADD COLUMN` lines — the only things that do real work on a fresh database are the `CREATE TABLE` statements, the trigger creation in step 16, and the "General" team backfill in step 6.

## 4. Triggers

Two triggers exist, both from `supabase-migration-previous-status.sql` (step 16 above):

- `screenings_track_previous_status` (`BEFORE UPDATE ON screenings`) — whenever `status` changes, copies the old value into `previous_status` before the row saves. Powers FunnelView's "where did this candidate come from" reporting.
- `tracker_track_previous_stage` (`BEFORE UPDATE ON tracker`) — identical mechanism for `stage` → `previous_stage`.

Both are plain `plpgsql` functions, re-creatable with `CREATE OR REPLACE FUNCTION` (already idempotent in the migration file). No other triggers exist anywhere in the schema — `status_updated_at` (on `screenings`) is set by application code (`lib/screenings.ts`) on every status-changing write, not by a database trigger.

## 5. Row Level Security — what's actually true

**Read this before writing any RLS policies as part of a "security compliance" pass — HireView's authorization boundary is not RLS.**

The Next.js server exclusively uses Supabase's service-role key (`lib/supabase.ts`), which bypasses RLS entirely by design. Every real access-control decision — which team's projects a recruiter can see, admin-vs-recruiter permissions, whether a given user can read/edit a specific project or screening by id — is enforced in the application layer (`lib/auth.ts`: `teamIdsFilter()`, `canAccessProject()`, `canAccessScreening()`, `canAccessCalibrationExample()`, each called explicitly from the relevant API route). The anon/public key is used only for Supabase Auth session handling (sign-in, cookie refresh) — it never touches a data table directly.

Concretely: `access_requests` and `feedback` have RLS explicitly disabled (their own migration files say so). Every other table has simply never had an RLS policy written — not because it was overlooked, but because the service-role key ignores RLS regardless, so a policy would currently be dead weight. If Brillio's security/compliance requirements call for RLS as defense-in-depth (reasonable for an enterprise deployment, and worth doing), that is **new work**, not something to migrate from the existing project — there is no existing policy set to carry over.

## 6. Storage

One bucket: **`resumes`** (constant `RESUME_BUCKET` in `lib/supabase.ts`). Holds three kinds of files, distinguished only by which table's `*_path` column points at them:

- Screened resumes (`screenings.resume_path`)
- LinkedIn cross-reference PDFs (`screenings.linkedin_pdf_path`)
- Calibration example resumes (`calibration_examples.resume_path`)

Create it as a **private** bucket (not public) — every read goes through the server's service-role key (`lib/screenings.ts`'s `getScreeningResume()`, etc.), never a public URL. In the Supabase dashboard: Storage → New bucket → name `resumes` → Public bucket: **off**.

`screenings.photo_url` is a plain text URL field (recruiter-pasted), not a Storage upload — no bucket involvement.

## 7. Auth

Supabase Auth, email/password. After the schema is in place:

1. Create the first user (Dashboard → Authentication → Users → Add user, or via the API).
2. Set that user's `app_metadata.role` to `"admin"` (Dashboard → Authentication → Users → click the user → Edit → raw `app_metadata` JSON: `{"role": "admin"}`). `lib/auth.ts`'s `isAdmin()` reads exactly this field — anyone without it is treated as a regular recruiter.
3. Every other user created afterward (via the app's own `/admin/users` invite flow, once an admin is logged in) defaults to `"recruiter"` unless explicitly promoted the same way.

## 8. Environment variables

See `.env.example` (repo root, added alongside this runbook) for the full list with descriptions. Summary: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` are required; `RESEND_API_KEY`, `NOTIFICATION_EMAIL`, `NEXT_PUBLIC_APP_URL` are optional (features degrade gracefully without them — no crash, just skipped email notifications / a fallback recipient / a fallback link).

## 9. Verification checklist

After running all 22 files:

- `select count(*) from information_schema.tables where table_schema = 'public'` should return 12 tables: `screenings`, `tracker`, `calibration_examples`, `projects`, `teams`, `team_members`, `screening_batches`, `resume_fingerprints`, `screening_actions`, `access_requests`, `feedback`, plus Supabase's own `auth.users` (not counted, lives in a different schema).
- `select * from teams where name = 'General'` should return exactly one row (created by step 6's backfill).
- Confirm the two triggers exist: `select tgname from pg_trigger where tgname like '%previous%'` should return `screenings_track_previous_status` and `tracker_track_previous_stage`.
- Confirm the `resumes` storage bucket exists and is private.
- Set `.env.local` (or your platform's environment variable settings) from `.env.example`.
- `npm install && npm run build` — should complete with all ~44 routes generated, zero errors.
- Sign in as the admin user created in §7, create a test project, screen a sample resume end to end.

## 10. Time estimate

Steps 1–8 (schema + storage + auth + env) are almost entirely copy-paste-and-run: 20–30 minutes for someone comfortable with a SQL editor. The remaining time in the "under 2 hours" budget is realistically spent on step 9's end-to-end smoke test and any platform-specific setup (Vercel project creation, DNS, etc.) outside this runbook's scope.
