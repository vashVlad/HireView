# HireView — Current State

*Last updated: 2026-07-01 (seeded from HireView-Dev-Log.docx, Architecture-Redesign doc, and git log — update this in place as state changes, don't just append)*

## Status: live, in active use at Brillio

Deployed workflow tool for a recruiter working two roles at once at Brillio. Multi-machine by design (work + personal computer).

## What's shipped

- **JD Analyzer** — paste a JD, get a full LinkedIn Recruiter sourcing brief: wide (discovery, 5k–15k results) and narrow (execution, 500–1k) filter sets, boolean strings, seniority, industries, company size, spotlights.
- **Resume Screener** — bulk PDF/Word upload, Claude scores each against the JD (0–100, must-have 65% / nice-to-have 35% weighting), ranked results, history with status pipeline (New Applicant → Recruiter Screen → Contacted → Screening → Archived). Sub-45 scores excluded from history (raised from 30 on 2026-07-01).
- **Credibility Checker (Phase 4)** — optional second resume + LinkedIn PDF cross-referenced against the screened resume; surfaces discrepancies before a TA call. LinkedIn PDF stored to Supabase Storage during check. Replaced the old "compare" feature.
- **Projects layer** — a project = one open role. Supabase `projects` table; `screenings.project_id` FK. This became the app's core organizing unit.
- **Architecture Redesign (shipped 2026-06-29)** — nav collapsed from 5 items to 2: **Projects** and **All Candidates**. Old routes (`/jd-analyzer`, `/history`, `/tracker`, `/screener`) redirect. Every role/project is a self-contained workspace with tabs: **Filters** (LinkedIn filters, copy buttons), **Screen** (uploader scoped to the role), **Pipeline** (candidate cards — status, flags, notes, credibility), **Tracker** (swimlane TA→L1→L2→In-Person→Offer/Reject, drag-to-reorder, slide-over drawer), **Settings**.
- **Tracker tab (added 2026-06-30)** — was originally a separate page, now folded in as a 5th project tab. Excel export. Scheduled/unscheduled indicator dots.
- **Interview View (added 2026-07-06)** — two popup windows per candidate on pipeline cards: left-half resume/LinkedIn viewer (`/interview/[id]/document`) and top-right notes window (`/interview/[id]`) with AI-generated interview questions (cached, lazy) and debounced notes. Windows tile exactly using complement sizing math. "View resume" button in expanded card also opens the document window.
- **Card redesign (2026-07-06)** — filename removed, credibility signal emoji removed from collapsed state, career story shows role hierarchy (bold headers, subordinate bullets, softer summary), roles displayed oldest-first (chronological), Credibility Check section collapsible (default closed).

## What's shipped (added 2026-07-07)

- **Multi-user auth (Task 1)** — Supabase Auth email/password, `@supabase/ssr` middleware, `/login` page, `user_id` on all three tables, recruiter isolation, admin sees all, `/admin/users` management page. User creation via `createUser` (no invite email) with pre-filled temp password `HireView2025!`. Sign-in is immediate.
- **Analytics dashboard (Task 2)** — `/analytics` admin-only. `screening_batches` aggregate table tracks all runs including below-threshold rejections (`scores int[]`, `passed_count`, `total_count`). 4 stat cards: Resumes Screened / Passed to Pipeline / Filtered Out / Time Saved. Score distribution, daily activity, by-role and by-recruiter tables. Date range + recruiter filter.
- **Calibration feedback UI (Task 3)** — Thumbs up/down in expanded pipeline cards. Thumbs down → correction modal (score slider + reason). `POST /api/history/[id]/calibrate` re-downloads resume + saves as calibration_examples. Core scoring logic untouched.
- **Configurable score threshold (Task 4)** — `score_threshold` column on projects (default 45). Slider in Settings tab. `screen-resumes` reads per-project threshold.
- **SiteHeader account dropdown** — person icon → dropdown with email (green dot), Change password link, Sign out. Admin nav links (Analytics, Team) with visual divider.
- **`/auth/set-password` page** — lets users update their temp password. Accessible via header dropdown.
- **JD file upload** — "Upload file" button in New Role modal. Supports PDF, DOCX, TXT via `POST /api/extract-jd-text` (reuses `extractResumeText`).

## What's shipped (added 2026-07-07, session 3)

- **Access request feature** — "Don't have access? Request it →" link on login page expands a collapsible form (email + name + message). Submissions saved to `access_requests` table + email to vladvashchuk2005@gmail.com via Resend (requires `RESEND_API_KEY` env var). Team page shows amber "Pending requests" section with Approve (creates account with `HireView2026!`) / Dismiss. SiteHeader shows pulsing amber dot badge on Team link when pending requests exist.
- **Keyword highlighting + match counts** — must-have (amber) and nice-to-have (violet) keywords highlighted inline in career trajectory text. Score chips show `X/Y kw` badge for fraud detection visibility.
- **Invite flow overhaul** — switched from `inviteUserByEmail` to `createUser` (no email rate limits, immediate activation). Default temp password `HireView2026!` pre-filled in form.
- **Photo in drawer** — candidate profile photo moved from chip to drawer as circular profile photo; still displays on tracker chip.
- **TypeScript fix** — `cookiesToSet` type annotation in `lib/supabase-server.ts` and `middleware.ts`.

## What's shipped (added 2026-07-08, Phase 1.1)

- **Duplicate Resume Detection (Phase 1.1 — merged to main)** — content fingerprinting (skills hash, responsibility vectors, metric claims, career arc signature) built from a second Claude extraction call per saved candidate, deliberately never matching on name/contact/company. New `resume_fingerprints` table, `duplicate_flag`/`duplicate_match_id` on `screenings`. Red "Duplicate detected" badge on collapsed Pipeline and All Candidates cards, click-to-jump to the matching candidate. Matching scoped to same project for v1 — cross-project matching is Feature 1.4, once Teams (1.3) exists. Built on `phase-1-fraud-prevention` (merged from `generalize-credibility-crossref` + `main`), verified with swapped-identity test resumes, PR #2 merged into `main` 2026-07-08.

## What's shipped (added 2026-07-08/09, Phase 1.2 — merged to main)

- **Recruiter Attribution** — full append-only action history (`screening_actions` table) logging status changes, tracker stage moves, flags, notes, and credibility checks with who and when. Threaded through `updateScreening`'s wrapper functions and `upsertTrackerEntry` via an optional `actorUserId` param, sourced from `getAuthUser()` in the two API routes that handle recruiter-driven changes. "Activity" section on the expanded Pipeline card shows the timeline with a colored initial avatar + bold email + plain-language description ("V moved Shiraz Amin to Recruiter Screen on Jul 9, 2026"). Migration run, live-tested (status change + flag), PR merged to main.

## What's shipped (added 2026-07-09, Phase 1.3 — code complete + migrated + live-tested, not yet committed)

- **Teams Architecture** — `teams` + `team_members` tables. `team_id` added to `projects` (source of truth) and denormalized onto `screenings` (from the project, at save time) so list queries filter with `.in("team_id", ...)` instead of a join. `lib/teams.ts` (create team, list with members, add/remove member, `getUserTeamIds`/`getPrimaryTeamId`). New `teamIdsFilter()` in `lib/auth.ts` — added alongside `userIdFilter` (not replacing it — `userIdFilter` stays exactly as-is because `screen-resumes/route.ts`, a do-not-touch file, depends on its sync signature). `/api/projects` GET and `/api/history` GET now scope by team instead of by individual `user_id`. New projects auto-assign to the creator's own team (no selector UI yet — deferred until someone actually belongs to 2+ teams, see decisions-log). Team management UI added to `/admin/users` (new "Teams" section: create team, add/remove members) — new `/api/admin/teams` + `/api/admin/teams/[id]/members` routes.
- **Real behavior change, not just additive:** this replaces per-user screening isolation with per-team isolation. Recruiters on the same team now see each other's projects and candidates, not just their own. Migration ran 2026-07-09; Vlad confirmed keeping the default "General" team as-is (both him and Teti share it for now — deliberate, not an oversight).
- Migrated and live-tested by Vlad: two teams created, add/remove member on the Teams UI confirmed working. One polish fix during testing — add/remove now updates the UI optimistically instead of waiting on a refetch (see decisions-log).
- Committed via Claude Code from Vlad's own machine (this session's sandbox git stayed broken all along — see open-questions.md): commit `b33f2b1` "feat: add Teams architecture (Phase 1.3)" on branch `phase-1-3-teams-architecture`, pushed to origin. PR not opened via `gh` (not on PATH in that environment either) — compare-URL fallback given instead: `https://github.com/vashVlad/HireView/compare/main...phase-1-3-teams-architecture?expand=1`. Not yet merged — awaiting Vlad's review.

## What's built, pending migration + live test (2026-07-09, Phase 1.4)

- **Candidate History Alert** — extends Phase 1.1's fingerprint matching across projects within the same team (the boundary 1.3 defined). Two new banners on the collapsed card, distinct from 1.1's existing same-project "Duplicate detected" (untouched): yellow "Previously seen" (this content pattern applied to another project before, no prior fraud signal) and red "Known fraud pattern" (the matched record, or this one, already carries a same-project `duplicate_flag` or was already flagged — escalation propagates through the match chain). New `history_alert_type`/`history_alert_match_id` columns on `screenings`, `team_id` denormalized onto `resume_fingerprints`. New `findCrossProjectMatch`/`markHistoryAlertPair`/`getScreeningFraudSignals` in `lib/resumeFingerprints.ts`, wired into `saveScreening`'s existing best-effort fingerprinting block. Both banners link to the matched candidate's project (resolved server-side via `enrichHistoryAlerts` — the match is usually not in the current page's already-loaded list, unlike 1.1's same-project case). Migration: `supabase-migration-history-alert.sql`, not yet run.
- **Live-tested and confirmed working 2026-07-09**, after debugging an app-wide outage (see decisions-log — `SCREENING_COLUMNS` referenced the new columns before the migration ran) and a real `getProject()` bug (missing `team_id` in its select, fixed). Confirmed: same resume into two projects in the same team correctly shows "Previously seen"; when the matched record already had a same-project `duplicate_flag`, it correctly escalated both sides to "Known fraud pattern" instead. Same-project resubmission correctly stays on 1.1's "Duplicate detected" and does not also trigger 1.4's banner (they're deliberately separate signals).
- **Follow-up UI addition, same session:** Projects page (`app/projects/page.tsx`) now groups project cards by team when more than one team is represented (admin viewing multiple teams, or a recruiter in 2+ teams) — single-team views are unaffected, no header shown. `ProjectSummary.teamName` added, resolved server-side in `getProjectSummaries`.

## What's NOT shipped yet

- **Outreach drafting (Phase 5)** — auto-draft LinkedIn messages. Repeatedly listed as next, never started.
- **Impact metrics** — measure screening time + TA false positive rate. Needed for BLUEPRINT Phase 2 validation.

## Deploy / migration status

**Pending as of 2026-07-09 (Vlad must run this):**
- `supabase-migration-history-alert.sql` — adds team_id to resume_fingerprints, history_alert_type/history_alert_match_id to screenings (Feature 1.4)

**Already applied** (cleaned up 2026-07-09 — this list had accumulated years of already-run migrations still marked "pending"; removing entries only when there's a direct confirmation in session-log.md, not just assumption): `supabase-migration-teams.sql` (Feature 1.3, confirmed by Vlad same session), `supabase-migration-screening-actions.sql` (Feature 1.2, confirmed live-tested), `supabase-migration-fingerprints.sql` (Feature 1.1, confirmed live-tested), `supabase-migration-interview.sql`, `supabase-migration-multiuser.sql`, `supabase-migration-threshold.sql`, `supabase-migration-batches.sql` — all implied done since the features they back (interview view, multi-user auth, configurable threshold, analytics) are in daily use and this session's own testing depended on auth/team features working.

## Stack

Next.js (App Router) · Tailwind · Anthropic API (`claude-sonnet-4-6`, server-side only) · Supabase · Vercel. TypeScript.

## Recruiter-facing workflow (as of the redesign)

Projects page → "New role" → paste/upload JD → analyze → name it → land on Filters tab → Screen tab (upload resumes, scoped to role, no re-entering JD) → Pipeline tab (review/flag/note) → Tracker tab (move through interview stages) → All Candidates for cross-role search.
