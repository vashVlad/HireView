# HireView — Decisions Log

Append-only. Newest at top. Each entry: the decision, and the reason — so future sessions don't reverse a decision without knowing why it was made.

---

**2026-07-09 — `phase-1-3-teams-architecture` retired after this merge; one branch per feature from now on.**
That branch ended up carrying five unrelated changes (Teams, Candidate History Alert, Fraud-Aware Interview Questions, the docs/migrations repo reorg, and FunnelView) because each new task was told to fold into "the existing open PR" to respect the don't-merge-without-review rule, rather than getting its own branch and getting merged promptly. Right rule, wrong implementation — bundling unrelated diffs makes review harder, not easier. Going forward: every new HireView task branches fresh off main; an already-open PR is a signal to merge it, not a place to keep stacking. Saved as a durable cross-session rule ([[feedback_git_branching]] in the global memory vault).

**2026-07-09 — FunnelView is admin-only and org-wide, deliberately not team-scoped.**
Matches the existing `/analytics` precedent exactly (admin sees everything regardless of team, no new role, no `teamIdsFilter`). The Enterprise Plan/Roadmap both confirm this explicitly ("does not require Teams"). Keeps FunnelView unblocked by Teams and consistent with the one other admin dashboard that already exists.

**2026-07-09 — `lib/funnelview/data.ts` runs its own direct Supabase queries, does not import or extend `lib/screenings.ts`/`SCREENING_COLUMNS`.**
FunnelView needs `user_id`, `linkedin_mode`, and `previous_status` on screenings — none of which are in the shared `SCREENING_COLUMNS` select every other candidate list depends on. Given this session's earlier incident (adding columns to that shared select broke candidate visibility app-wide before its migration ran), the safer and architecturally cleaner choice is a fully isolated query in `lib/funnelview/`, matching the module's own stated design goal ("no entanglement with core scoring files"). Zero risk to any existing page.

**2026-07-09 — A rejected/archived candidate's funnel "high-water mark" is `previous_stage`, not their current Reject stage.**
`Reject` is a terminal branch, not a step in the linear TA→L1→L2→In-Person→Offer progression — counting it as "further along" than Offer would be wrong. `furthestStage()` in `lib/funnelview/data.ts` falls back to `previous_stage` (already tracked via the Postgres trigger from the 2026-07-08 entry below) whenever current stage is `Reject`, so the funnel bars credit candidates for the real progress they made before being rejected. Archived/rejected candidates are reported as a separate count, not folded into the cumulative stage bars, so they don't distort conversion percentages between stages.

**2026-07-09 — Phase 1.5 fraud-aware questions: fraudSignals is an optional param on the existing generateInterviewQuestions, not a second function or a new route.**
No new table, no schema change — this feature is pure prompt composition over data 1.1/1.4/credibility-checker already produce (`duplicate_flag`, `history_alert_type`, `credibility.rows` discrepancies). The route computes a `FraudSignals` object for every candidate but only passes it into the prompt when `hasFraudSignal()` is true, so a clean candidate's prompt is byte-for-byte what it was before this feature existed — no conditional drift for the common case.

**2026-07-09 — "Who ran the screening" wasn't showing for admin-run screenings — fixed by re-resolving the session user inside saveScreening, not by touching screen-resumes/route.ts.**
`userIdFilter()` (used by `screen-resumes/route.ts` for an unrelated purpose — scoping the calibration-examples lookup) returns `undefined` for admin by design, since it was built as a query filter ("admin sees everything, no filter needed"). That `undefined` was also getting passed into `saveScreening` and used as the attribution actor for the "created" action, silently dropping admin's own screenings from the Activity timeline. Since `screen-resumes/route.ts` is do-not-touch, the fix lives entirely inside `saveScreening` (`lib/screenings.ts`): it now calls `getAuthUser()` itself to resolve the true acting user for the `logAction` call specifically, leaving the `userId` param's existing role (screenings.user_id, team lookup) untouched. Safe because both callers of `saveScreening` already require an authenticated session before reaching this point.

**2026-07-09 — New `GET /api/teams` (not `/api/admin/teams`) added so recruiters can see their own team's roster, not just admins.**
The existing `/api/admin/teams` is admin-gated and used by the Team management page. The Projects page needed team member chips for everyone, including recruiters viewing their own team — reusing the admin route would have meant either exposing admin-only data or duplicating the query. New route reuses `listTeamsWithMembers()` unchanged, filtering down to the caller's own teams for non-admins via `getUserTeamIds()`.

**2026-07-09 — Incident: adding new columns to the shared SCREENING_COLUMNS select broke candidate visibility app-wide before the migration ran.**
While building 1.4, `history_alert_type`/`history_alert_match_id` were added to the column list `listScreenings`/`getScreeningsByIds` select — functions every candidate list in the app depends on, not just the new feature. `supabase-migration-history-alert.sql` (which adds those columns) hadn't been run yet, so every screening query started failing outright — Pipeline, All Candidates, everything, for admin and recruiter alike. Root-caused from Vlad's report ("admin nor recruiter can see any candidates") and fixed by running the migration. **Lesson, applies to every future phase:** any column added to a *shared, already-live* query path (not just a new feature's own tables) must have its migration run — or at minimum be confirmed run — before that code path is considered safe to leave running, even in dev. A feature's own new table can safely wait on migration; touching a shared column list on an existing table cannot. Also saved as a durable cross-session feedback memory (see MEMORY.md).

**2026-07-09 — `getProject()` was missing `team_id` from its select statement, so every screening saved through a project got `team_id: null`.**
Found while debugging the visibility incident above (a real, separate bug, not the main cause). `team_id` was added to `listProjects`/`getProjectSummaries`/`ProjectRow` in 1.3 but not to the singular `getProject()`, which `saveScreening` depends on to resolve the team to save on each screening. Fixed by adding `team_id` to that select. Any screenings saved between 1.3 shipping and this fix need a one-time backfill (`UPDATE screenings SET team_id = projects.team_id WHERE ... team_id IS NULL`) — given to Vlad directly, not yet folded into a migration file since it's a data fix, not a schema change.

**2026-07-09 — History alert escalation (previously_seen vs known_fraud_pattern) keys off duplicate_flag, not a new detection pass.**
1.4's job is distinguishing "this background pattern applied elsewhere before" (informational, yellow) from "this pattern already has fraud history" (red) — not re-running fraud detection. Reused the signal 1.1 already computes: if either side of a cross-project match already carries `duplicate_flag = true` (a confirmed same-project identity-swap) or was already `known_fraud_pattern` itself, the new match escalates to `known_fraud_pattern` for both sides; otherwise it's `previously_seen`. This makes the alert chain propagate — once a pattern is caught once, every later reappearance anywhere in the team inherits the red state — without a second matching algorithm.

**2026-07-09 — Cross-project matching denormalizes team_id onto resume_fingerprints, same pattern as screenings/projects in 1.3.**
`findCrossProjectMatch` needs to scope "same team, different project" — joining through `projects.team_id` on every fingerprint comparison would be slower and more complex than filtering a plain column. Added `resume_fingerprints.team_id`, set at save time from the same `teamId` already computed for the screening insert.

**2026-07-09 — Matched candidate's name/project are resolved server-side (enrichHistoryAlerts), not left for the client to find in its own already-loaded list.**
1.1's same-project "Duplicate detected" badge gets away with a client-side `screenings.find()` because the matched record is guaranteed to already be in that page's loaded list (same project). A 1.4 cross-project match usually isn't — the Pipeline tab only loads one project's screenings. `listScreenings`/`getScreeningsByIds` now batch-resolve the matched screening's candidate name and project (id + name) after the main query, so the banner and its link work correctly on both the single-project Pipeline tab and the team-wide All Candidates page.

**2026-07-09 — Team management UI (add/remove member) updates optimistically, not via wait-then-refetch.**
Vlad flagged after live-testing that adding a member to a new team didn't feel immediate. `handleAddMember`/`handleRemoveMember` now update local `teams` state synchronously before the network call resolves, then still call `fetchTeams()` afterward to reconcile with server truth. Apply this pattern to future admin-UI actions in HireView (toggles, list add/remove) rather than defaulting to fetch-then-refetch.

**2026-07-09 — Team-based isolation added via a new `teamIdsFilter()`, `userIdFilter()` left untouched rather than converted.**
`userIdFilter()` is synchronous and `screen-resumes/route.ts` (do-not-touch) calls it without awaiting. Team lookups require a DB query, so making `userIdFilter` async would silently break that call site with no way to fix it. Added a separate async `teamIdsFilter()` instead; the two now coexist — `userIdFilter` still backs per-recruiter attribution on save (unchanged), `teamIdsFilter` backs the new team-scoped list views (`/api/projects`, `/api/history`).

**2026-07-09 — team_id denormalized onto `screenings` from the project, not joined at query time.**
Screenings don't have their own team concept — a project does. Rather than join through `project_id` on every list query, `saveScreening` resolves and stores `team_id` once at save time (from the project, or from the saving user's own team if there's no project). Matches the existing pattern of denormalizing `user_id` onto screenings despite `projects` also having it.

**2026-07-09 — New Role modal gets no team-selector UI yet; new projects auto-assign to the creator's first team.**
The Enterprise Plan's spec calls for "new project creation requires team selection," but every current user belongs to exactly one team (there's only "General" until Vlad creates a second one), so a dropdown would have nothing to choose between. Deferred until someone actually has 2+ team memberships — auto-assign covers the real Phase 1.3 success criteria (two teams, one recruiter each) without adding UI for a choice that doesn't exist yet.

**2026-07-09 — Teams management UI added to the existing `/admin/users` page, not a new route.**
The page is already nav-labeled "Team" and is the established home for admin-only user/access management. A second admin nav item for team-vs-user administration would fragment a workflow that's naturally one screen for a two-person org.

**2026-07-08 — Recruiter attribution logged via app-level threading, not a DB trigger (unlike previous_status/previous_stage).**
A trigger can't know which HireView user made a change — the app talks to Supabase via a single service-role client, so the DB only ever sees that role, never the acting recruiter. `actorUserId` is threaded through `updateScreening`/`updateScreeningStatus`/`updateScreeningFlag`/`updateScreeningNotes`/`updateScreeningCredibility`/`upsertTrackerEntry` as an optional trailing param (backward compatible — existing calls without it still compile), sourced from `getAuthUser()` in the two API routes that handle recruiter-driven changes (`history/[id]`, `tracker/[screeningId]`). System-generated updates (career trajectory regen, interview questions, photo URL, LinkedIn PDF path) don't pass a userId and so don't appear in the timeline — only actual recruiter actions do.

**2026-07-08 — screening_actions is a full append-only history; previous_status/previous_stage only ever hold the latest transition.**
The two serve different purposes: previous_status/previous_stage (Feature 1.1-era stopgap) are enough for FunnelView's "where did this candidate come from right now" need, but can't reconstruct a full timeline since they get overwritten on every change. screening_actions logs one row per action instead, so the whole history — every status change, stage move, flag, note, credibility check, all with who and when — is reconstructable.

**2026-07-08 — FunnelView built inside HireView as isolated module, not separate repo.**
Data already lives in HireView — exporting to CSV and re-uploading to a separate tool adds overhead with no benefit at this stage. Isolated module (`app/funnelview/` + `lib/funnelview/`) ships fast now and has a clean extraction seam if other departments need a standalone version later. Admin-only access slots into existing gate — no new role needed. `previous_status`/`previous_stage` tracking already implemented via Postgres trigger. Gated on Phase 1 (1.1→1.5) being fully complete before build starts — as of this entry, only 1.1 has shipped.

**2026-07-08 — previous_status/previous_stage tracked via DB trigger, not app-code, and status/stage were not renamed.**
FunnelView (separate standalone dashboard, reads a HireView CSV export) needs "where did this candidate come from" data, which HireView never recorded — status/stage get overwritten in place, no history. Considered renaming `status`→`current_status` + adding `previous_status`, but `status` is referenced throughout the app (types, queries, every screening/tracker component) and the additive-only schema rule forbids renaming existing columns. Instead added `previous_status`/`previous_stage` columns kept in sync by a Postgres BEFORE UPDATE trigger — captures every change regardless of which code path makes it, not just ones going through a specific app function. This is a lightweight stopgap, not full Feature 1.2 (Recruiter Attribution) — no who-changed-it data, just before/after value. Existing rows have NULL previous_status/previous_stage until their next change; no backfill possible since prior values were never recorded.

**2026-07-08 — Duplicate detection (1.1) matches within the same project only, not cross-project/team-wide.**
Teams (1.3) doesn't exist yet, so there's no defined "same team" boundary for cross-project matching — that's explicitly Feature 1.4's job once Teams ships. Project-scoped matching avoids leaking candidate identities across recruiter isolation boundaries prematurely, and matches the Enterprise Plan's own test case (both resumes uploaded to the same project).

**2026-07-08 — Fingerprint extraction uses a second Claude call per saved candidate, not raw-text hashing.**
Matching has to survive "name/company/contact swapped, everything else the same" — a literal hash or text diff of the resume would trivially fail since names/companies are exactly what differs. Claude extracts identity-scrubbed skills/responsibility/metric/career-arc fields (never name, contact, or company); skills are hashed for an exact-match signal, the rest compared with token-based Jaccard similarity at an 85% threshold. Only runs for candidates that actually get persisted (score >= project threshold), so filtered-out candidates cost nothing extra.

**2026-07-08 — Duplicate detection hooks into lib/screenings.ts saveScreening, not app/api/screen-resumes/route.ts.**
route.ts and scoreCandidate.ts are do-not-touch core files. saveScreening already receives the resume buffer, so fingerprinting + matching runs there as a best-effort step after the insert, wrapped in try/catch — a fingerprinting failure can never block or corrupt a screening save.

**2026-07-08 — Duplicate flag is set bidirectionally on both matched screenings.**
The Enterprise Plan's test case says the system flags "them" (plural). Both records get `duplicate_flag=true` and point `duplicate_match_id` at each other, so whichever card a recruiter opens first shows the badge and links to the other.

**2026-07-07 — JD file upload reuses extractResumeText via a thin /api/extract-jd-text route.**
Same PDF/DOCX/TXT extraction utility used by the resume screener. No new dependencies. "Upload file" button overlaid on the New Role textarea corner — text populates the textarea, then flows through the existing analyze path unchanged.

**2026-07-07 — User creation uses createUser (not inviteUserByEmail) to avoid Supabase email rate limits.**
`inviteUserByEmail` always sends an email, which hits Supabase free tier rate limits (2–4/hr) during testing. `createUser` with `email_confirm: true` + a temp password creates the user immediately with no email. Admin shares credentials directly. User can change password via "Change password" in the header dropdown.

**2026-07-07 — Rejected candidates tracked via aggregate screening_batches table, not individual rows.**
`screening_batches` stores one row per screening run: `scores int[]`, `total_count`, `passed_count`. Analytics can compute "Filtered Out" and score distribution across ALL resumes (including below-threshold) without filling the screenings table with records the recruiter will never act on. Historical backfill: existing screenings grouped by day+user+project (total_count = passed_count for those rows since old scores were never stored).

**2026-07-07 — Calibration feedback saves to calibration_examples via resume re-download, not a new table.**
Re-downloads the resume from Supabase Storage, re-extracts text, saves a new calibration_examples record. Keeps the entire scoring pipeline unchanged. Score correction captured as a text note in the `note` field. No new DB tables needed beyond the user_id column already added for multi-user.

**2026-07-07 — score_threshold is per-project (DB column), defaults to 45. Not a global setting.**
Hardcoded 45 replaced with `project.scoreThreshold ?? 45` in the screen-resumes route. Admins set 0–100 per role in Settings tab. Global default kept at 45 via DB column default so existing rows need no migration.

**2026-07-07 — Analytics uses auth.admin.listUsers() for email lookup, not a profiles table.**
Admin-only dashboard — using the service role key's admin API avoids building and maintaining a separate user profiles table for email lookups.

**2026-07-06 — Interview View uses two separate buttons (one popup each), not one button opening multiple windows.**
Browsers block all but the first `window.open()` per user gesture. Tried: single container with 3 iframes (popup blocker), navigate current tab + one popup (timing issues). Final design: two icon buttons on the card — one for resume, one for notes — each triggering exactly one popup. Clean, reliable, no workarounds needed.

**2026-07-06 — Window sizing uses complement math: `sw - halfW` for resume, `halfW` for notes.**
`Math.floor(sw/2) + Math.floor(sw/2)` can equal `sw - 1` on odd screen widths. Using the complement ensures both windows always sum to exactly `screen.availWidth`.

**2026-07-06 — Credibility signal emoji removed from collapsed pipeline cards.**
OS emoji rendering (⛔, ⚠) looks jarring against the dark UI. Signal is still shown in the expanded card header and CredibilitySection. Do not bring emojis back to the collapsed card.

**2026-07-06 — Career trajectory displayed oldest-first (chronological), reversed at render time.**
Claude outputs trajectory newest-first (resume order). Reversal happens in `TrajectoryRenderer.buildRenderOrder()` by grouping role blocks and reversing the array. No DB regeneration needed — works on all existing records.

**2026-06-30 — Tracker folded into project tabs, not a standalone page.**
The pipeline view now lives as a 5th tab on the project detail page instead of its own `/tracker` route. Keeps the "zero context switching" goal of the redesign intact.

**2026-06-29 — Nav collapsed to 2 items: Projects, All Candidates. Role is the organizing unit, not the action.**
Production usage showed nobody ever screens without a role attached. The old 5-item nav (Screener/JD Analyzer/History/Tracker as siblings) was overhead with no payoff. Root cause: Projects had been layered *on top of* a tool-centric architecture instead of replacing it. Explicitly: no DB schema changes, no API route changes — only navigation/composition changed.

**2026-06-29 — Blueprint v2.0 adopted as the project's operating framework.**
All future HireView work follows the 5-phase methodology in `BLUEPRINT_Operations_Systems_Builder.md`: problem statement with real metrics before any build.

**~mid-June 2026 — Credibility Checker replaced the "Compare" feature entirely.**
Compare covered the same ground with more UI friction. Checker takes optional LinkedIn PDF + second resume, both optional (not every candidate has a LinkedIn PDF).

**~mid-June 2026 — Prompt rewritten for strict one-sentence / label:gap output format.**
Cut AI output tokens ~60%, made results more scannable. Added a "More" button per concern for on-demand 2-3 sentence drill-down, instead of always showing full detail.

**~mid-June 2026 — Comparison/credibility results persist to Supabase instead of recomputing.**
History page needs to show past results without re-running the model each time.

**Early June 2026 — Screener moved to `/` (main route), JD Analyzer moved to `/jd-analyzer` with a Beta badge.**
Screener is the core tool and entry point; JD Analyzer is a supporting utility, not where work starts.

**Early June 2026 — Never use `bash cp` between routes; always use Read/Write/Edit tools for file operations in this repo.**
A path mismatch between the Edit tool's Windows path and the Linux sandbox mount path silently corrupted files via `cp` on at least two separate occasions (once causing full route-file truncation, once corrupting nine source files). This is now a hard rule, not a preference.

**Early June 2026 — Must-have skills weighted 65%, nice-to-have 35% in resume scoring.**
Initial scoring treated every JD bullet equally, which scored too low. Explicit weighting plus "practical equivalence" rules fixed it.

**Early June 2026 — localStorage caching removed entirely, will not be reintroduced without explicit reason.**
Caused a full page crash in production (cached data had the wrong shape after a deploy). Lesson logged: state living outside the deploy cycle has no shape validation.
