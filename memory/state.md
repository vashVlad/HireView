# HireView — Current State

*Last updated: 2026-07-01 (seeded from HireView-Dev-Log.docx, Architecture-Redesign doc, and git log — update this in place as state changes, don't just append)*

## Status: live, in active use at Brillio

Deployed workflow tool for a recruiter working two roles at once at Brillio. Multi-machine by design (work + personal computer).

## What's shipped

- **JD Analyzer** — paste a JD, get a full LinkedIn Recruiter sourcing brief: wide (discovery, 5k–15k results) and narrow (execution, 500–1k) filter sets, boolean strings, seniority, industries, company size, spotlights.
- **Resume Screener** — bulk PDF/Word upload, Claude scores each against the JD (0–100, must-have 65% / nice-to-have 35% weighting), ranked results, history with status pipeline (New Applicant → Recruiter Screen → Contacted → Screening → Archived). Sub-30 scores excluded from history.
- **Credibility Checker (Phase 4)** — optional second resume + LinkedIn PDF cross-referenced against the screened resume; surfaces discrepancies before a TA call. Replaced the old "compare" feature.
- **Projects layer** — a project = one open role. Supabase `projects` table; `screenings.project_id` FK. This became the app's core organizing unit.
- **Architecture Redesign (shipped 2026-06-29)** — nav collapsed from 5 items to 2: **Projects** and **All Candidates**. Old routes (`/jd-analyzer`, `/history`, `/tracker`, `/screener`) redirect. Every role/project is a self-contained workspace with tabs: **Filters** (LinkedIn filters, copy buttons), **Screen** (uploader scoped to the role), **Pipeline** (candidate cards — status, flags, notes, credibility), **Tracker** (swimlane TA→L1→L2→In-Person→Offer/Reject, drag-to-reorder, slide-over drawer), **Settings**.
- **Tracker tab (added 2026-06-30)** — was originally a separate page, now folded in as a 5th project tab. Excel export. Scheduled/unscheduled indicator dots.

## What's NOT shipped yet

- **Outreach drafting (Phase 5 in the roadmap / Phase 3 in CLAUDE.md numbering — naming is inconsistent, see open-questions)** — auto-draft personalized LinkedIn messages from resume highlights. Repeatedly listed as "what's next" across multiple dev log entries going back to Phase 0 completion; never started.
- **Interview question generator** — mentioned once as next after the architecture redesign, not picked up since.
- **Impact metrics** — "measure screening time per role and TA false positive rate across 2–3 roles" has been on the "what's next" list since the Phase 2/3 planning entry and does not appear to have been done yet. Needed to validate the 60% throughput claim already stated in the BLUEPRINT.

## Deploy / migration status

Confirmed by Vlad (2026-07-01): latest code is deployed to Vercel and all pending Supabase migrations (`supabase-migration-projects.sql`, `scheduled` column, `credibility jsonb` column) have been run. Treat the app as live and current, not just "shipped in the repo."

## Stack

Next.js (App Router) · Tailwind · Anthropic API (`claude-sonnet-4-6`, server-side only) · Supabase · Vercel. TypeScript.

## Recruiter-facing workflow (as of the redesign)

Projects page → "New role" → paste/upload JD → analyze → name it → land on Filters tab → Screen tab (upload resumes, scoped to role, no re-entering JD) → Pipeline tab (review/flag/note) → Tracker tab (move through interview stages) → All Candidates for cross-role search.
