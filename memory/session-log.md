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
