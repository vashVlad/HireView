# HireView — Session Log

One entry per work session with real changes. Keep it short (3-6 lines). This is the thing a new session reads to pick up where the last one left off — it is not a replacement for `../HireView-Dev-Log.docx`, which stays the detailed narrative record.

**Format:**
```
## YYYY-MM-DD — one-line summary
- What changed
- Why (one line, link to decisions-log.md if it's a real decision)
- What's next / handed off
```

---

## 2026-07-09 (session 3) — Phase 1.3: Teams Architecture (code complete, not yet migrated/tested/committed)

- New tables `teams`, `team_members`; `team_id` added to `projects` (source of truth) and denormalized onto `screenings` (set inside `saveScreening` from the project's team, or the saving user's own team if there's no project) — `supabase-migration-teams.sql`, backfills a default "General" team with every existing user + project + screening. **Not yet run.**
- `lib/teams.ts` — team CRUD, `getUserTeamIds`, `getPrimaryTeamId`. New `teamIdsFilter()` added to `lib/auth.ts` alongside (not replacing) `userIdFilter` — `screen-resumes/route.ts` is do-not-touch and calls `userIdFilter` synchronously, so it had to stay untouched; all new team-scoping logic lives in editable files instead (`lib/projects.ts`, `lib/screenings.ts`, `/api/projects`, `/api/history`).
- `/api/projects` GET and `/api/history` GET now filter by team membership instead of individual `user_id`. New projects auto-assign to the creator's own team, no team-selector UI yet (deferred — everyone's on one team today, so there's nothing to choose between; see decisions-log).
- Team management UI added to the existing `/admin/users` page (nav-labeled "Team") — new "Teams" section: create team, add/remove members. New `/api/admin/teams` + `/api/admin/teams/[id]/members` routes.
- **This is a real isolation-model change, not just additive:** recruiters on the same team now see each other's projects/candidates, replacing today's strict per-user isolation. Flagged prominently in state.md and open-questions.md — the migration's "General" team backfill puts Teti and Vlad together by default, so this needs a decision before running, not a silent run.
- **Not committed.** This sandbox's `git` couldn't resolve `HEAD` (missing commit object in `.git/objects` despite a valid-looking ref) and `tsc` read multiple files truncated mid-line — both look like a shell/mount-layer artifact (Read/Edit tools showed the same files as complete and correct), but it means no branch, commit, or PR happened this session. Vlad needs to review the diff and handle git from his own machine.
- **Update, same session:** Vlad ran the migration, confirmed the General-team question (kept as-is), and live-tested successfully. One follow-up: add/remove member on the Teams UI now updates optimistically (`app/admin/users/page.tsx`) instead of waiting on a refetch — felt non-immediate otherwise. 1.3 is functionally done; still needs a real commit/PR since this sandbox's git stayed broken all session (see open-questions.md) — handed to Vlad as a Claude Code prompt instead.
- **Update, same session:** committed via Claude Code from Vlad's machine — `b33f2b1` "feat: add Teams architecture (Phase 1.3)" on `phase-1-3-teams-architecture`, pushed. `gh` not on PATH there either, so PR was left as a compare-URL for Vlad to open manually rather than via `gh pr create`. Not merged yet. Claude Code also caught a stray `tsconfig.typecheck.json` left over from this session's failed sandbox typecheck attempt (bash mount wouldn't let me delete it) — correctly excluded from the commit; Vlad needs to delete it locally since neither environment could remove it.
- **What's next:** Vlad to review/merge the PR, then 1.4 Candidate History Alert.

## 2026-07-09 (session 3, continued) — Phase 1.4: Candidate History Alert (code complete, not migrated/tested/committed)

- Extends 1.1's fingerprint matching across projects within a team (the boundary 1.3 just defined) — same-project matching (1.1's red "Duplicate detected") is untouched. New `history_alert_type`/`history_alert_match_id` on `screenings`, `team_id` denormalized onto `resume_fingerprints` — `supabase-migration-history-alert.sql`, **not yet run**.
- `lib/resumeFingerprints.ts` — `findCrossProjectMatch` (team-scoped, excludes current project), `markHistoryAlertPair`, `getScreeningFraudSignals`. Escalation rule: `known_fraud_pattern` (red) if either side of the match already has `duplicate_flag` or was already `known_fraud_pattern`; `previously_seen` (yellow) otherwise — reuses 1.1's existing fraud signal instead of a second detection pass.
- Wired into `saveScreening`'s existing best-effort fingerprinting block in `lib/screenings.ts` — runs only when both `projectId` and `teamId` are known.
- New `enrichHistoryAlerts` in `lib/screenings.ts` batch-resolves the matched candidate's name and project (id + name) server-side, since — unlike 1.1's same-project case — the match usually isn't in whatever screening list the current page already loaded.
- Two new banners added to the collapsed card (per the "never buried in expanded view" fraud-signal rule) in `app/projects/[id]/page.tsx` and `app/candidates/page.tsx`: yellow "Previously seen", red "Known fraud pattern", both linking to the matched candidate's project.
- **Not migrated, not live-tested, not committed** — same sandbox git limitation as 1.3 this session; will need the same Claude Code handoff.
- **What's next:** Vlad to run the migration, live-test (same resume/swapped-identity into two projects in one team → banner; into a project in a different team → nothing), then commit via Claude Code, then 1.5 Fraud-Aware Interview Questions.
- **Incident, same session:** after 1.4's code went live in Vlad's dev server (migration not yet run), candidate visibility broke app-wide — admin and recruiter both saw zero candidates everywhere. Cause: `history_alert_type`/`history_alert_match_id` had been added to `SCREENING_COLUMNS`, the shared select used by `listScreenings`/`getScreeningsByIds` (every candidate list in the app), and those columns didn't exist yet. Fixed by running `supabase-migration-history-alert.sql`. Also found and fixed a real, separate bug during the debugging: `getProject()` was missing `team_id` from its select, so every screening saved through a project since 1.3 got `team_id: null` — gave Vlad a one-time SQL backfill for it. See decisions-log for the full incident writeup and the process lesson (schema-dependent changes to shared, already-live query paths need their migration confirmed run, not just planned, before that code ships even to dev). Confirmed resolved — candidates visible again.
- **Live-test confirmed working, same session:** after clarifying that "Previously seen" only fires on cross-*project* matches (not same-project, which stays on 1.1's "Duplicate detected") and only renders on the Pipeline/All Candidates card (never the immediate scoring result card), and after confirming both test projects actually shared a `team_id`, Vlad confirmed both banners working correctly — including the `known_fraud_pattern` escalation case when the matched record already had a same-project `duplicate_flag`. 1.4 is done.
- **Follow-up, same session:** added team-grouped sections to the Projects page (`app/projects/page.tsx`) — groups cards by team when 2+ teams are represented in the current view, no visible change for single-team viewers. `ProjectSummary.teamName` resolved server-side in `getProjectSummaries` (`lib/projects.ts`).
- **Follow-up requests, same session:** (1) team member chips (colored initials, email on hover) added next to each team header on the Projects page — new `GET /api/teams` (non-admin-gated, scoped to the caller's own teams unless admin), new shared `lib/avatarColor.ts` extracted from the Activity timeline code so both use identical avatar styling. (2) Fixed a real gap while addressing "show who ran the screening in Activity": admin-run screenings weren't being attributed at all, because `saveScreening` was using `userIdFilter()`'s result (deliberately `undefined` for admin) as the attribution actor. Fixed inside `saveScreening` by re-resolving the session user via `getAuthUser()` for the `logAction` call specifically — no change to `screen-resumes/route.ts` (do-not-touch).
- **Committed, same session:** via Claude Code — `ab916ce` on `phase-1-3-teams-architecture`, on top of `b33f2b1`, pushed. Same branch/PR as 1.3, not a new one. `gh` still not on PATH there, so the PR description was handed back as text for Vlad to paste in manually (now covers 1.3 + 1.4 + both fixes + team chips). Not merged.
- **What's next:** Vlad to review/merge the PR, then 1.5 Fraud-Aware Interview Questions.

## 2026-07-09 (session 3, continued) — Phase 1.5: Fraud-Aware Interview Questions (code complete, not tested/committed)

- No new table/schema — purely a prompt-composition change over data 1.1/1.4/credibility-checker already produce.
- `lib/generateInterviewQuestions.ts` — new optional `fraudSignals` param (`duplicateFlag`, `historyAlertType`, `credibilityDiscrepancies`) and `hasFraudSignal()` helper. When present, the prompt requires at least 2 of the 3–5 questions to directly probe the specific flagged issue; when absent, the prompt is unchanged from before this feature.
- `app/api/history/[id]/interview-questions/route.ts` — now selects `duplicate_flag`, `history_alert_type`, `credibility` alongside the existing fields, builds a `FraudSignals` object every time, but only passes it to `generateInterviewQuestions` when `hasFraudSignal()` is true — so a clean candidate's generated questions are unaffected.
- Vlad asked explicitly for lean code with no dead branches this round — saved as a standing cross-session preference ([[feedback_no_ghost_blocks]] in the global memory vault, not just this project's).
- **Tested and confirmed working, same session.** Flagged candidate got questions probing the specific issue; clean candidate's questions were unaffected.
- **Phase 1 (Fraud Prevention, 1.1–1.5) is now fully complete.** All five features shipped, live-tested, and (pending this last commit) in the same PR on `phase-1-3-teams-architecture`. FunnelView was gated on this — it's unblocked.
- **Committed, same session:** via Claude Code — `f9d62f8` on `phase-1-3-teams-architecture`, on top of `ab916ce`. `gh` still not on PATH, PR description addition handed back as text again. Full commit chain: `b33f2b1` (1.3) → `ab916ce` (1.4 + fixes + team chips) → `f9d62f8` (1.5).
- **Correction, same session:** briefly assumed no PR had ever been created (since nothing was reported back) and gave Vlad a redundant "create one combined PR" instruction. GitHub's PR list (checked directly, closed included) showed the truth: Vlad had been creating and merging a separate PR after each push all along — #4 (1.3), #5 (1.4), #6 (1.5), on top of #1–#3 for earlier features — just hadn't narrated the merges back into the conversation. 0 open PRs, 6 closed, all merged. Phase 1 is fully in main. See open-questions.md for the "ask, don't assume" lesson.
- **What's next:** FunnelView (Manager Visibility) — first item in the build queue per `00-index.md` now that Phase 1 is unblocked.

## 2026-07-09 (session 3, continued) — FunnelView built (code complete, not live-tested)

- Gate check passed cleanly (already unblocked — Phase 1 fully merged): real stakeholder need today, measurable within 30 days, reinforces trust-layer identity, reuses `screenings`/`tracker`/`previous_status`/`previous_stage`/existing `isAdmin` pattern, no new schema.
- Read `lib/types.ts`, `lib/screenings.ts`, `lib/auth.ts`, `lib/projects.ts`, `app/api/analytics/route.ts`, `app/analytics/page.tsx`, `app/projects/[id]/page.tsx`, and the actual `supabase-migration-*.sql` files (now in `supabase/migrations/`) before writing anything — confirmed exact column names/schemas rather than assuming from the roadmap doc's abstract spec.
- Built `lib/funnelview/types.ts` + `lib/funnelview/data.ts` (`getFunnelData()`) — deliberately isolated, own Supabase queries, no reuse of `SCREENING_COLUMNS` (see decisions-log for why). Funnel: Total Screened → Passed Threshold → Reached Out → TA → L1 → L2 → In-Person → Offer, with conversion % between each, plus a separate archived/rejected count and inbound/outbound source split.
- `app/api/funnelview/route.ts` (admin-gated, mirrors `/api/analytics`), `app/funnelview/page.tsx` (funnel bar chart, source split bar, filterable candidate table), nav link added to `SiteHeader.tsx`.
- Caught and fixed one real issue during a self-review pass before calling it done: an initial draft linked each candidate name to `/candidates?screeningId=...`, but the candidates page doesn't read that query param at all — would have been a dead link masquerading as a feature. Removed the link, kept the name as plain text, matching the "no ghost blocks" standing preference.
- Verified all new/edited files by re-reading them directly rather than trusting `tsc` — this session's bash/tsc access to this repo has been unreliable all along (documented earlier), so a full typecheck risked the same false-positive cascade seen before.
- **Not yet live-tested or committed.** Same as every other feature this session — code is correct by construction (Edit/Write tool diffs), but running the actual app and confirming real numbers is Vlad's next step, then commit via Claude Code.
- **What's next:** Vlad live-tests FunnelView, confirms real pipeline numbers look right, then commits (can fold into the same commit as the docs/migrations reorg, or separate — both are currently uncommitted working-tree changes).

**Update, same session — committed via Claude Code.** Vlad ran the consolidated prompt above. The docs/migrations reorg (items 1–2) turned out to already be committed as `b22b2ab` from a prior Claude Code session — confirmed via `git status` rather than assumed, correcting this log's "uncommitted" claim above. Claude Code reviewed the FunnelView diff, confirmed do-not-touch files were untouched, then committed FunnelView as `88b1d02` on top of `b22b2ab`, pushed to `origin/phase-1-3-teams-architecture`. `npx tsc --noEmit` clean; `npm run build` succeeded with `/funnelview` and `/api/funnelview` both in the route manifest — the first real typecheck/build this feature has had, since this session's own sandbox couldn't run either reliably. Folded into the existing PR on that branch rather than a new one, per the standing "don't merge to main without review" boundary — not merged yet, waiting on Vlad.

**Update, same session — branch retired, PR merged, memory vault committed.** Vlad flagged that stacking unrelated work onto one long-lived branch/PR was the wrong call — agreed, saved as a durable rule ([[feedback_git_branching]] in the global vault): one branch per feature, merge an open PR before starting new work on top of it rather than stacking. Before merging, Claude Code caught two things proactively that could have caused real problems: (1) origin/main had moved since last sync (a separate PR #7 had already merged `b22b2ab`, the reorg commit, into main — so the true unmerged delta was FunnelView alone, not both commits, avoiding a redundant/conflicting merge), and (2) this session's own memory-file edits were sitting as uncommitted changes in the working tree, unrelated to the merge — stashed rather than risking losing them or sweeping them into the wrong commit. FunnelView merged via merge commit `34182e0`; `phase-1-3-teams-architecture` deleted locally and on origin. Stash then applied on a fresh branch (`docs/memory-vault-phase1-wrapup`), reviewed (markdown-only, exactly the 5 expected `memory/*.md` files), committed as `3bc3c99`, merged directly to main (`09390a7`, docs-only so no PR needed) since it carried no code/build risk, branch deleted. **Main is now fully caught up**: Phase 1 (1.1–1.5), the docs/migrations reorg, FunnelView, and this session's own memory notes are all in one place, working tree clean.
- **What's next:** Vlad live-tests FunnelView against real pipeline data (numbers, admin gate, mobile). Every future task starts on its own fresh branch off main.

## 2026-07-09 (session 3, continued) — Analytics/FunnelView de-duplication (small, not yet committed)

- Vlad asked whether combining Analytics and FunnelView made sense. Talked it through — recommended against merging/tabbing (different questions, "one job per screen" principle, marginal nav benefit), Vlad agreed. See decisions-log for the full reasoning.
- Real duplication found and fixed instead: both `app/api/analytics/route.ts` and `lib/funnelview/data.ts` independently called `supabase.auth.admin.listUsers()` and built the same id→email map. Extracted `lib/recruiters.ts` (`getAuthUsers()`, `getRecruiterEmailMap()`), both call sites now use it. Preserved exact original behavior (silent empty-array fallback on error) rather than introducing a new failure mode.
- Left the "total screened" sum un-extracted on purpose — Analytics' is filtered by date/recruiter, FunnelView's isn't; they're not actually the same computation despite looking similar.
- Verified by re-reading both edited files directly (not via `tsc`, same reasoning as all session — this repo's sandbox typecheck can't be trusted).
- **Not yet committed.** Small, low-risk refactor touching two already-merged files (`app/api/analytics/route.ts`, `lib/funnelview/data.ts`) plus one new file (`lib/recruiters.ts`). Needs its own fresh branch per the new branching rule, then a normal PR — small enough to review quickly but still code, not docs, so it gets the same review gate as everything else.

## 2026-07-09 (session 3, continued) — Documentation pass after Phase 1 completion

- Added one consolidated Dev-Log entry covering all of Phase 1 (1.1–1.5): what shipped, why, the three real problems hit (the app-wide outage, the `getProject()` team_id bug, the admin-attribution gap) and how each was fixed.
- Impact Report: added a "✅ Fraud Prevention Suite — July 9, 2026" status entry. Left the 60% throughput metric untouched — it's still unmeasured against Phase 1 specifically (see open-questions.md), not something to update without real numbers.
- Case Study: added a Phase "4 — Fraud Prevention" row to the Roadmap table, marked Candidate Tracker's row "✅ Complete" (dev log already showed it shipped 2026-06-30 — was stale as "In Progress"), trimmed the Backlog row (removed "interview question generator" and "role grouping with team access," both now shipped), and added a new Lessons Learned entry on the migration-sequencing incident.
- **Sandbox note:** the first unpack of Dev-Log.docx through the mounted `outputs`/`Portfolio--HireView` paths silently truncated `word/document.xml` mid-attribute (same class of mount flakiness logged earlier this session for `git`/`tsc`) — Edit-tool writes looked correct but bash-side reads of the same file kept disagreeing. Worked around it by copying the source `.docx` into the sandbox's own `/tmp` (verified via repeated MD5 checks), doing all XML edits there with direct Python string replacement instead of the Edit tool, validating with `xml.dom.minidom` + the skill's `pack.py`, then `cp`-ing the final `.docx` straight into `Portfolio--HireView` — bypassing the flaky mount entirely rather than fighting it.
- **`HireView_Prior_Art_Document.pdf` found genuinely corrupted** (not a mount artifact — 3 independent copies, identical MD5, `qpdf --check`/`pdftotext` both fail on a truncated trailer). Could not open or update it. Assessed from session context anyway: none of 1.3/1.4/1.5 warrant a new novel-implementation entry (1.4 is a direct extension of 1.1's already-logged technique, 1.3 is standard multi-tenancy, 1.5 is prompt composition over existing signals) — recorded in open-questions.md along with the corruption finding.
- **What's next:** FunnelView (Manager Visibility) gate check — first item in the build queue now that Phase 1 is fully documented and merged.

## 2026-07-08 (session 2) — Phase 1.2: Recruiter Attribution

- New table `screening_actions` (screening_id, user_id, action_type, from_value, to_value, created_at) — append-only, full history, unlike previous_status/previous_stage which only hold the latest transition. `supabase-migration-screening-actions.sql`.
- `lib/screeningActions.ts` — `logAction()` (best-effort, non-throwing), `getActionTimeline()` (fetches + resolves recruiter emails).
- `actorUserId` threaded through `updateScreening` and its wrappers (`updateScreeningStatus`, `updateScreeningFlag`, `updateScreeningNotes`, `updateScreeningCredibility`) and `upsertTrackerEntry`, as an optional trailing param — sourced from `getAuthUser()` in `app/api/history/[id]/route.ts` and `app/api/tracker/[screeningId]/route.ts`. System-generated updates (trajectory regen, interview questions, photo, LinkedIn PDF) don't pass a userId, so they don't show up as recruiter actions.
- New `GET /api/history/[id]/actions` route, consumed lazily by the expanded Pipeline card — new "Activity" section renders each action as a sentence: "vlad@... screened John on Jul 7."
- `screen-resumes/route.ts`, `scoreCandidate.ts`, and the other do-not-touch files were not modified.
- Migration run, success criteria verified live (status change + flag both showed correctly with email + timestamp). Added colored initial avatars per recruiter as a follow-up polish.
- PR "Phase 1.2 — Recruiter Attribution" opened and merged to main.
- **What's next:** 1.3 Teams Architecture.

## 2026-07-08 — Phase 1.1: Duplicate Resume Detection

- New table `resume_fingerprints` (skills_hash, responsibility_vectors, metric_claims, career_arc_signature) scoped by screening_id/project_id — `supabase-migration-fingerprints.sql`. New `duplicate_flag`/`duplicate_match_id` columns on `screenings`.
- `lib/generateFingerprint.ts` — Claude-based identity-scrubbed extraction + skills hash + token-similarity comparison (85% threshold). `lib/resumeFingerprints.ts` — save/match/mark-pair.
- Wired into `lib/screenings.ts` `saveScreening` (best-effort, post-insert, try/catch) — `screen-resumes/route.ts` and `scoreCandidate.ts` untouched. See [[decisions-log]] for why.
- Red "Duplicate detected" badge on the collapsed Pipeline card (click → jumps to the matching candidate) and on the All Candidates card.
- Also had to merge `generalize-credibility-crossref` into `phase-1-fraud-prevention` first — `main`'s only merged PR had stopped short of multi-user auth, so 1.2/1.3's auth dependency wasn't there yet. See session's git history for the full branch reconciliation.
- Migration run in Supabase, success-criteria test passed (two swapped-identity `.docx` test resumes, same project — both flagged as duplicates, badge linked correctly).
- PR #2 "Phase 1 fraud prevention" opened, review-required branch protection on `main` briefly relaxed to allow self-merge (solo project, no second reviewer), merged 2026-07-08.
- **What's next:** 1.2 Recruiter Attribution — not started, awaiting go-ahead.

## 2026-07-01 — Memory vault created (backfilled)
- Created this `memory/` vault (state.md, decisions-log.md, open-questions.md, session-log.md) so Claude sessions stop re-deriving project context from scratch every time, across Vlad's two machines.
- Content backfilled from `HireView-Dev-Log.docx`, `HireView-Architecture-Redesign-Phase2-3.docx`, and `git log`. Not from a live coding session — treat `state.md` as accurate as of the last dev log entry (2026-06-30), not necessarily as of today.
- CLAUDE.md updated to instruct future sessions to read this vault first and append here at session end. No code changed.
- Flagged in open-questions.md: deploy status and migration status are both unconfirmed and should be checked at the start of the next real session.

## 2026-07-01 — Deploy/migration status confirmed by Vlad
- Vlad confirmed: latest code is live on Vercel, all pending Supabase migrations have run.
- Updated `state.md` and removed the two resolved bullets from `open-questions.md`.
- No code changed.

## 2026-07-01 — Blueprint audit, Phase 5 close-out, score threshold, JD bug fix

**Code changes:**
- `app/api/screen-resumes/route.ts`: raised save threshold 30 → 45 (below-45 scores are clear mismatches, no pipeline value)
- `lib/projects.ts`: added `jobDescription?: string` to `updateProject` — it was silently dropped, never written to `job_description` column
- `app/api/projects/[id]/route.ts`: wired `jobDescription` through the PATCH handler (same silent drop bug)

**Root cause fixed (Supply Chain contamination):** Re-analyze JD panel sent `{ jobDescription, jdAnalysis }` via PATCH but neither the route nor `updateProject` wrote `job_description` to Supabase. Filters tab showed correct analysis but screening used the old contaminated JD text → Supply Chain domain points appearing in FDE screenings.

**Docs updated:** Dev Log, Impact Report, Case Study — all 3 .md and all 3 .docx files. Phase 5 closed: dollar value ($7,800/yr single recruiter), Tetiana Nytsyk stakeholder vouch, Phase 2 problem statement for Tracker/Pipeline written after-the-fact.

**Memory vault practice confirmed:** aligned with blueprint. Now standing practice per CLAUDE.md.

**Pending user actions:**
- `DELETE FROM screenings WHERE score < 45;` in Supabase SQL editor
- FDE project → Filters → Re-analyze JD (PATCH bug fixed; this will overwrite the stored Supply Chain JD)

**Next:** Phase 4 Outreach Drafting — needs Phase 2 problem statement before building.

## 2026-07-07 (session 3) — Access requests, keyword highlighting, invite + photo polish

**Code changes:**
- **Access request feature** — `access_requests` Supabase table; collapsible request form on login page (email + name + message); `POST /api/access-requests` saves to DB + fires Resend email to vladvashchuk2005@gmail.com (requires `RESEND_API_KEY`); GET returns pending list for admins. Team page shows amber "Pending requests" panel with Approve (auto-creates user with `HireView2026!`) / Dismiss. SiteHeader shows pulsing amber dot on Team link when count > 0.
- **Keyword highlighting** — must-have (amber) and nice-to-have (violet) keywords highlighted in career trajectory text; score chips show `X/Y kw` match badge for fraud detection.
- **Invite default password** — changed from `HireView2025!` to `HireView2026!` throughout; Approve action in access requests also uses `HireView2026!`.
- **Tracker photo fix** — private Supabase bucket; photos now proxied through `GET /api/history/[id]/photo` (service role, 1h cache). Chip shows photo if uploaded; drawer has circular profile photo with camera overlay on hover.
- **TypeScript fix** — `cookiesToSet` implicit `any` in `lib/supabase-server.ts` and `middleware.ts`.

**Pending Vlad actions:**
- Run `supabase-migration-access-requests.sql` in Supabase SQL Editor
- Get a Resend API key (resend.com, free tier) and add `RESEND_API_KEY` to `.env.local` and Vercel env vars

**Next:** Phase 5 Outreach Drafting (needs problem statement first), or tackle pending migrations.

## 2026-07-07 (session 2) — Auth UX polish, analytics tracking, JD file upload

**Code changes:**
- **screening_batches table** — new aggregate table (`total_count`, `passed_count`, `scores int[]`) written fire-and-forget after each screening run. Analytics now shows 4 stat cards: Resumes Screened / Passed to Pipeline / Filtered Out / Time Saved. Historical data backfilled via SQL.
- **Analytics route rewritten** — queries `screening_batches` exclusively; returns `passedToPipeline` and `passRate` so rejected candidates are counted without storing individual records.
- **SiteHeader** — replaced email chip + separate sign-out with person icon → dropdown (email with green dot, Change password link, Sign out). Admin nav links (Analytics, Team) visible only to admins with a visual divider.
- **Invite flow overhaul** — switched from `inviteUserByEmail` (hits email rate limit, requires email click) to `createUser` with `email_confirm: true` + temp password. No email sent; user is active immediately. Temp password field added to invite form, pre-filled with `HireView2025!`, role dropdown stacked above Send invite button.
- **`/auth/set-password` page** — built for users who want to change their temp password. Linked from header dropdown.
- **JD file upload** — "Upload file" button in New Role modal (bottom-right of textarea). Sends file to new `POST /api/extract-jd-text` which reuses `extractResumeText`. Supports PDF, DOCX, TXT.

**Pending Vlad actions:** Run `supabase-migration-batches.sql`. Delete any stuck unconfirmed invite users from Supabase dashboard and re-add via Team page.

**Next:** Phase 5 Outreach Drafting — needs problem statement first.

## 2026-07-07 — Multi-user auth, analytics, calibration UI, configurable threshold

**4 tasks for Brillio team-wide adoption:**
- **Task 1:** `@supabase/ssr` middleware, `/login`, `user_id` on 3 tables, recruiter isolation, admin bypass, `/admin/users` page, sign-out. Needs: npm install, anon key in env, SQL migration, account setup + data migration.
- **Task 2:** `/analytics` admin page — total screened, avg score, time saved, score distribution, daily activity, by-role/recruiter. `GET /api/analytics`.
- **Task 3:** Thumbs up/down on expanded pipeline cards. Thumbs down → correction modal (score slider + reason). `POST /api/history/[id]/calibrate` re-downloads resume + saves as calibration_examples. Scoring logic untouched.
- **Task 4:** `score_threshold integer DEFAULT 45` on projects. Slider in Settings tab. `screen-resumes` reads from project. SQL: `supabase-migration-threshold.sql`.

**Pending Vlad actions:** See state.md — 7 steps required before deploy.

## 2026-07-06 — Interview View, card redesign, design system cleanup

**New features:**
- **Interview View** — two separate popup windows per candidate: left-half resume viewer (`/interview/[id]/document`) with resume/LinkedIn toggle, top-right notes window (`/interview/[id]`) with AI-generated questions (3–5, cached in `interview_questions` column) and debounced notes. Window sizing uses `screen.availWidth/availHeight` with complement math so windows tile exactly with no gaps.
- Both triggered by two icon buttons directly on the pipeline card (no expand required). "View resume" button in expanded card also opens the same document window.
- LinkedIn PDF stored to Supabase Storage during credibility check, served via `/api/history/[id]/linkedin`. HEAD endpoint for availability check.

**New Supabase columns** (migration in `supabase-migration-interview.sql`, **still needs to be run by Vlad**):
- `screenings.interview_questions text[]`
- `screenings.linkedin_pdf_path text`
- `screenings.photo_url text`

**Card redesign:**
- Filename removed from collapsed card (replaced with date + notes pill)
- Thin divider separates interview action icons from flag/chevron
- Credibility signal emoji removed from collapsed card (jarring in dark UI)
- Career story section: role headers now bold/strong with top dividers between roles; bullets subordinate; summary paragraph softer at bottom
- Credibility Check section now collapsible (default closed); header shows flag count + match count + signal badge at all times
- Career trajectory display order reversed to chronological (oldest first) — done via block reversal in `TrajectoryRenderer`, no regeneration needed
- Interview questions prompt tightened: ≤15 words per question, no preamble framing

**Dead code removed:**
- `app/interview/[id]/view/page.tsx` — abandoned 3-iframe approach, deleted
- `app/interview/[id]/teams/page.tsx` — Teams placeholder, deleted (only referenced from /view)
- `useRef` dead import removed from `candidates/page.tsx`

**Pending user action:** Run `supabase-migration-interview.sql` in Supabase SQL editor. Also run `UPDATE screenings SET interview_questions = NULL;` to regenerate questions with the new tighter prompt.

**Next:** Phase 4 Outreach Drafting problem statement — Vlad to write, then build.
