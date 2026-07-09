# HireView — Decisions Log

Append-only. Newest at top. Each entry: the decision, and the reason — so future sessions don't reverse a decision without knowing why it was made.

---

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
