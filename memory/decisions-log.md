# HireView — Decisions Log

Append-only. Newest at top. Each entry: the decision, and the reason — so future sessions don't reverse a decision without knowing why it was made.

---

**2026-07-10 — Cross-project-fit gate's stuck-forever bug reappeared; fixed with a `mountedRef`, not by touching the dependency array again.**
Vlad reported "Checking other active roles…" showing and then never resolving — the exact symptom the [[feedback_useeffect_self_cancel]] fix (Phase 2.1) was supposed to have closed. Root cause was adjacent, not a reversion: that fix's `cancelled` flag was set in the effect's cleanup, and `onCheckCrossProjectPromise` (a prop passed from `app/projects/[id]/page.tsx` as an inline arrow function, recreated every parent render) is still in the effect's dependency array. Nearly any parent re-render while the gate call is in flight reruns the effect; `gateStartedRef` correctly blocks a second API call from starting, but the ORIGINAL run's cleanup still fires and flips `cancelled`, so its result is silently discarded when it resolves — `setCheckingGate(false)` never runs. Fix: replaced the per-run `cancelled` closure variable with a `mountedRef` set once via its own `[]`-dependency effect (true unmount only) — a same-instance rerun triggered by prop-identity churn no longer cancels the in-flight call's ability to update state. `gateStartedRef` alone remains the guard against starting a second call. Not fixed by memoizing `onCheckCrossProjectPromise` in the parent (would also work, but leaves the same trap for the next inline-function prop passed into this effect) — see [[feedback_useeffect_self_cancel]], worth updating with this addendum.

---

**2026-07-09 — FunnelView per-project breakdown built on a shared `computeStages()` helper, not a second copy of the funnel logic.**
The blended org-wide funnel and each per-project funnel need to count things identically (same definition of "passed threshold," same cumulative tracker-stage logic, same archived/rejected handling) or a manager comparing the two views would see numbers that don't reconcile. Rather than trust two hand-written implementations to stay in sync, extracted the counting logic out of `getFunnelData()` into `computeStages(totalScreened, candidates)` and call it once for the blended view and once per project — a future change to the funnel definition only has one place to edit, and the two views can't silently drift apart.

**2026-07-09 — Per-project breakdown includes projects with below-threshold-only batches (zero persisted `screenings` rows), not just projects with saved candidates.**
A project where every resume screened so far scored below the save threshold would otherwise vanish from `byProject` entirely, which is exactly the kind of badly-converting role this feature exists to surface. Project list is the union of `screening_batches.project_id` and candidates' `projectId`, not just one or the other.

---

**2026-07-10 — Auto-fire rebuilt a fourth time on a cheap Claude classification call instead of any local heuristic. Supersedes the keyword-overlap entry directly below.**
The keyword-overlap gate (previous entry) was checked against the actual failing test case (Alex Kim / AI Developer) and also missed it — traced to a deeper structural problem, not a bad threshold: the gate matched against `result.careerTrajectory`, and `scoreCandidate`'s own tool schema generates that field scoped to "the role being hired for" (the CURRENT project) — see the `careerTrajectory` field description in `lib/scoreCandidate.ts`. That means the text being matched was never a neutral resume summary; it's already filtered through the current role's lens, so it can omit or de-emphasize a different role's relevant vocabulary regardless of résumé or JD length. Confirmed concretely: only ~1/5 of the AI Developer JD's must-have vocabulary (Python, LLM APIs, prompt design, fine-tuning, vector search/embeddings/RAG) appeared literally anywhere in Alex Kim's current-role-scoped trajectory text, despite a real 82 score on that project. Three consecutive local heuristics (must-have score, overall score, keyword overlap) all failed for the same underlying reason: they approximate a semantic judgment with something structurally weaker than semantic judgment. Vlad chose to stop trying to fix that class of approach and pay for real judgment instead: new `POST /api/cross-project-fit/gate` re-extracts the actual resume text (not the role-scoped summary — same extraction the real check already does) and makes one cheap Claude call with a minimal output schema (`{promising: boolean}`) against short role-name + must-have-list summaries, not full JDs. Real semantic judgment, not free, but far cheaper than the full check's N complete scoring passes (each generating a full trajectory + strengths + concerns). Fails closed (`promising: false`) on any error — a broken gate degrades to "show the manual link," never to a crash or a silently-stuck auto-fire. Explicitly not guaranteed to be perfect (no classifier is), but doesn't share the specific structural blind spot that killed all three prior attempts.

**2026-07-10 — Auto-fire brought back a third time, this time gated on per-project keyword overlap instead of a reused score. Superseded by the entry above — kept here for the reasoning trail.**
Vlad pushed back on dropping auto-fire — wanted it actually fixed, not removed. The two prior gates failed because they used the candidate's fit against the CURRENT project (`mustHaveScore`, or overall score) as a proxy for fit against a DIFFERENT project — which the 32→82 case proved has no reliable relationship. The fix: stop reusing a single number and compute the signal directly against each OTHER project's own requirements. `GET /api/cross-project-fit` now also returns each other active project's `mustHaveSkills` (already stored from the JD Analyzer, free to read). `ResultCard.tsx` computes, per candidate, the best keyword-overlap ratio between their resume text and any other project's must-have list (`countKeywordMatches`, already used elsewhere for the current project's keyword badges — reused, not reinvented) and auto-fires when that ratio clears 50%. This is a genuinely different signal, not a third threshold guess on the same broken proxy — it's evaluated per-project-pair using that project's actual requirements, which is exactly what was missing. Still zero extra Claude cost to evaluate the gate itself (pure client-side string matching); the real API cost only happens when the gate says yes, same cost structure Vlad approved originally. **Not validated against real candidates yet** — per Vlad's own standing lesson (see the entry below), this needs to be checked against a couple of real cases, including the known 32→82 example if reproducible, before trusting the 50% figure.

**2026-07-10 — Cross-Project Fit auto-fire removed entirely; feature is manual-only. Superseded by the entry above — kept here for the reasoning trail.**
Built by Claude Code this session on `feat/cross-project-fit-suggestion`. The auto-fire gate (originally `mustHaveScore >= 50` / `score >= threshold - 15`, see the two entries below) was meant as a cheap proxy for "worth checking automatically" — live-tested by Vlad and found unreliable on a real candidate: `mustHaveScore: 32` on the current project, but scored 82 (a strong, clearly-should-have-fired suggestion) on another active project. Widened once (`>= 35` / `>= threshold - 25`) per Vlad's choice — still failed the same 32→82 case, because the underlying premise was wrong: a candidate's must-have score against *this* project's specific requirements has no reliable relationship to their fit against a *different* project's different requirements — the exact scenario this feature exists to catch. Rather than keep guessing a wider threshold, asked Vlad again with the concrete evidence; he chose to drop auto-fire entirely rather than tune further. The "Check other active roles" link is now always manual — predictable cost (only spent when a recruiter clicks), nothing silently missed by a bad heuristic. `GET /api/cross-project-fit`'s cheap eligibility count still exists and still gates whether the link renders at all — only the *auto-fire* behavior was removed, not the whole gate concept.

**2026-07-10 — Cross-Project Fit gained a one-click "Transfer to [Project]" action; no longer purely a read-only suggestion.**
Built by Claude Code this session, same branch. Supersedes part of the earlier "deliberately stateless — nothing persisted" decision (see below): the suggestion itself is still generated fresh on every check (no caching), but accepting it now actually does something — Transfer posts the already-scored result to the existing `/api/screenings/save-one` route (the same one "Save anyway" already used), saving the candidate directly into the *other* project's pipeline without re-scoring. Reasoning: a recruiter who sees "this candidate scored 82 on AI Developer" then has to manually re-upload the same resume into that other project to actually act on it — a suggestion with no one-click path to acting on it is friction, not intelligence. Still no new schema (reuses the existing screenings save path exactly as-is), so the "no new tables" half of the original decision still holds even though "nothing persisted" no longer does.

---

**2026-07-10 — Team deletion orphans (not blocks-on or cascade-deletes) projects/candidates assigned to that team.**
Considered pre-checking member/project counts and blocking delete until empty, but that's inconsistent with how `deleteProject` already works in this codebase (delete the row, trust the FK constraints already in place). Confirmed the actual FK behavior from the Phase 1.3/1.4 migrations rather than assuming: `projects.team_id`/`screenings.team_id`/`resume_fingerprints.team_id` are `ON DELETE SET NULL`, so nothing is destroyed — a team with active projects can be deleted, and those projects just lose their team assignment instead of erroring or cascading away real work. The real risk is silent invisibility (an orphaned project drops out of every recruiter's team-scoped view until reassigned), so that's surfaced directly in the delete confirmation dialog rather than solved by blocking the action outright.

---

**2026-07-10 — Cross-Project Fit Suggestion gets a free eligibility gate instead of leaving "should I click this?" to the recruiter.**
Vlad flagged that the plain "Find a better fit" button gave no signal for whether checking was worth it. Rather than a heuristic that just hides/shows a button, built three tiers using data already on hand (no extra API cost for the classification itself): (1) hard gate — if there are zero other active projects in the team, nothing renders, checked via a new cheap `GET /api/cross-project-fit` count endpoint; (2) "promising" band (`mustHaveScore >= 50`, or `score >= threshold - 15` when must-have isn't available) auto-fires the real check with no button at all — mirrors the scorer's own 65/35 must-have weighting, on the theory that a candidate clearing half the must-haves has something real to offer, just not here; (3) everything else gets a de-emphasized "Check other active roles anyway" link, preserving manual override without pushing it. This removes the guessing problem entirely rather than tuning a button's visibility.

**2026-07-10 — Auto-fired fit checks are serialized through a single-flight queue (`fitQueueRef` in `ScreenTab`), not fired in parallel per card.**
A batch of several below-threshold "promising" candidates auto-firing simultaneously would create a burst of concurrent Claude calls right after a bulk screening completes — each cross-project-fit check itself does up to 3 concurrent sub-calls, so N promising cards firing at once multiplies fast. A simple promise-chain queue (`fitQueueRef.current = fitQueueRef.current.then(run, run)`) bounds this to one cross-project-fit request in flight at a time, shared across every card on the page, regardless of whether it was auto-fired or manually clicked.

**2026-07-10 — `GET /api/cross-project-fit` reuses the exact same `getUserTeamIds()` scoping as the POST handler in the same file, not `/api/projects`' `teamIdsFilter()`.**
`/api/projects` uses `teamIdsFilter()`, which returns `undefined` for admin (sees all teams). If the eligibility count had reused that route, an admin could see "other active projects: 3" from `teamIdsFilter`'s everything-view while the real POST check (deliberately always team-scoped, see the earlier 2026-07-10 entry on cross-project fit) came back empty — a visible inconsistency. Keeping both handlers in the same file with identical scoping logic makes that mismatch structurally impossible instead of relying on two files staying in sync.

---

**2026-07-10 — Phase 2.1 Cross-Project Fit Suggestion is on-demand (button), not automatic.**
Firing a cross-project re-score automatically for every below-threshold candidate means one extra Claude API call per other active team project, per candidate, silently — and HireView's API costs are paid from Vlad's personal funds (see Prior Art doc, Section 2.1). An explicit "Find a better fit" button also matches the Enterprise Plan's own UI standard ("Buttons say exactly what happens") and the existing "Save anyway" precedent for the same below-threshold card.

**2026-07-10 — Cross-project fit route always scopes by `getUserTeamIds()`, not `teamIdsFilter()`.**
`teamIdsFilter()` returns `undefined` for admin, meaning "no filter, sees everything" — correct for list views, but wrong here: "same team" is the entire point of this feature (per the Enterprise Plan spec), so an admin shouldn't get suggestions spanning projects/teams they don't actually work on. Used the underlying `getUserTeamIds(user.id)` directly instead, so behavior is identical for admin and recruiter.

**2026-07-10 — Cross-project fit re-sends the original resume file from the browser rather than reusing the CandidateResult already returned from screening.**
`CandidateResult` (the JSON already sent back from `/api/screen-resumes`) has no raw resume text field — only a synthesized summary/career trajectory. Re-scoring off that synthesized text would be lower-fidelity than the original screening pass. The browser still holds the original `File` object at the results stage (same precondition the existing "Save anyway" flow already depends on), so the new route re-extracts text from the real file instead, matching the same accuracy as the primary screen.

**2026-07-10 — Cross-project fit is stateless — no new table, no persistence.**
The Enterprise Plan's 2.1 spec doesn't call for new schema, and the suggestion is only useful in the moment the recruiter is deciding what to do with a low-scoring candidate — persisting it would need to be invalidated whenever any project's threshold or JD changes, for no real benefit. Generated fresh on every "Find a better fit" click instead.

**2026-07-10 — Cross-Project Fit Suggestion not added to the Prior Art document.**
Reuses the existing scoring engine directly against multiple job descriptions — an applied use of an existing capability, not a new technique. Same bar applied to 1.3 (standard multi-tenancy) and 1.5 (prompt composition) skipping the Prior Art doc while 1.1/1.4's actual fingerprinting technique got documented.

---

**2026-07-09 — FunnelView validated against real data — 78 candidates, numbers confirmed accurate.**
FunnelView tested against live HireView pipeline data. Funnel: 78 screened → 66 passed threshold (85%) → 24 reached out → 6 TA → 3 L1 → 3 L2 → 1 In-Person → 0 Offer, plus 10 archived. Funnel visualization confirmed accurate. Excel export added (two sheets: Funnel Summary, All Candidates) for structured data sharing with stakeholders who need offline access to candidate-level detail — generated client-side from the same live data already on screen, not cached. Impact Report updated with real validated numbers replacing all projections, including a Business Value calc and a Who Can Vouch entry (Tetiana Nytsyk; featured in the FDE Recruiting Executive Update to Suchin, Director of TA, covering 372 candidates screened across the full team). Note: this session initially held off writing these numbers into the Impact Report/decisions-log/Prior Art PDF because they weren't reflected in any prior memory file — Vlad confirmed directly that the validation and the executive report both happened before this entry was written.

---

**2026-07-09 — Outreach Drafting removed from the roadmap entirely, not deprioritized.**
Vlad: "let's remove outreach drafting. We don't need it." It had been listed as "next" in nearly every session log entry since Phase 0 (variously numbered "Phase 3," "Phase 4," or "Phase 5" across CLAUDE.md and the dev log — see open-questions.md) without ever getting a Phase 2 problem statement, which is itself a sign it was never a real priority. Removed the Phase 3 section from CLAUDE.md's roadmap, moved the item from state.md's "What's NOT shipped yet" to a new "Descoped" section, and resolved the two related open-questions.md bullets (the phase-numbering ambiguity was mostly caused by this exact item). Historical dev log / impact report entries that mention it in past "what's next" notes were left untouched — those are dated records of what was true at the time, not a live roadmap. Case Study's Backlog row updated to drop the item since it's a current-state list, not a historical entry.

---

**2026-07-09 — Analytics and FunnelView stay separate pages, not merged into one screen or tabbed together.**
Considered combining them (Vlad asked directly) since both are admin-only "look at data" screens and the admin nav has grown to 3 items. Decided against it: they answer genuinely different questions (Analytics = is the AI screening tool performing well — throughput, pass rate, score distribution; FunnelView = is the human pipeline converting — funnel stages, drop-off, source split) rather than being alternate views of the same thing, so tabbing them violates "every screen has one job" (hireview-enterprise-skill.md) for a nav-reduction benefit (3→2 admin items) that's marginal compared to what the original 5→2 primary-nav redesign solved (that nav sat in front of every recruiter on every task; this one is admin-only, occasional-use, two users). What *was* real: both pages independently called `supabase.auth.admin.listUsers()` and rebuilt the same id→email map. Extracted `lib/recruiters.ts` (`getAuthUsers()`, `getRecruiterEmailMap()`) and pointed both `app/api/analytics/route.ts` and `lib/funnelview/data.ts` at it — genuine duplication fixed without touching the product surface. Did *not* extract the "total screened" sum despite looking similar in both files — Analytics' version is filtered by date range/recruiter, FunnelView's isn't; forcing them into one parameterized helper for a one-line `.reduce()` would be over-engineering for zero real risk.

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
