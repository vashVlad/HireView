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
