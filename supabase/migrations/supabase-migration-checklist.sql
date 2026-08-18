-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: JD checklist ("Trust badge") — projects.checklist,
-- screenings.checklist_evaluation
-- Run this in Supabase SQL editor → Run
--
-- Vlad's ask, 2026-08-15/17: a per-project, recruiter-editable checklist
-- derived from the JD ("decrease" items = specific gaps worth deducting
-- points for if unevidenced, "add" items = specific reinforcing signals
-- worth bonus points if evidenced). Generated via lib/generateChecklist.ts,
-- evaluated per candidate at screening time via lib/evaluateChecklist.ts,
-- applied as a deterministic score delta in lib/screenings.ts's
-- saveScreening() — same architecture as the target-company boost (see
-- supabase-migration-target-company-boost.sql), NOT baked into
-- scoreCandidate.ts's do-not-touch prompt.
--
-- Two columns, two different tables, two different purposes:
--   projects.checklist          — the checklist DEFINITION (items, points),
--                                  set once per project via the Filters tab,
--                                  read/written by lib/projects.ts's isolated
--                                  getProjectChecklist/updateProjectChecklist.
--   screenings.checklist_evaluation — the per-candidate RESULT (which items
--                                  fired, why, and the resulting score delta),
--                                  written by saveScreening()'s existing
--                                  best-effort secondary update (same call
--                                  that already writes target_company_matches/
--                                  current_company/etc.), read back via
--                                  lib/screenings.ts's isolated
--                                  attachChecklistEvaluations (NOT the shared
--                                  SCREENING_COLUMNS select — same Migration
--                                  Sequencing rule as every other deferred
--                                  column here; see current_company's
--                                  migration for the 2026-08-06 incident that
--                                  rule exists to prevent).
--
-- IMPORTANT — run this BEFORE deploying the code that reads/writes it. Until
-- it runs, checklist generation/evaluation simply doesn't happen (both are
-- opt-in, gated on whether a project has a checklist at all) — no existing
-- scoring, saving, or reading path is affected either way.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS checklist jsonb;

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS checklist_evaluation jsonb;

-- No backfill needed — every existing project/screening predates this
-- feature and simply has no checklist configured (null), which both the
-- generation UI and the scoring path already treat as "opt-in not yet
-- exercised," not an error state.
