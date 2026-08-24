-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Require a target-company match before scoring (pre-score gate)
-- Run this in Supabase SQL editor → Run
--
-- Vlad's ask, 2026-08-24: "add a toggle there that would make companies look
-- up first before moving farther into screening. So when the candidate
-- doesn't have a company that is listed in the score boost companies list in
-- their resume, then it gets filtered out." A per-project Filters-tab toggle
-- — when ON, a resume that doesn't mention ANY of the project's "Score boost
-- companies" (jdAnalysis.wide/narrow.targetCompanies, see
-- lib/targetCompanyBoost.ts) is archived immediately, before the checklist
-- Gate 1 evaluation or the full scoreCandidate()/generateFingerprint() pair
-- ever run — same "cheap, deterministic check before any AI call" pattern as
-- the blacklist pre-score gate (supabase-migration-blacklist.sql) and the
-- checklist Gate 1 (lib/evaluateGate1.ts).
--
-- Deliberately additive and defaulted to false (opt-in, not opt-out) — every
-- existing project keeps scoring exactly as it does today; this only takes
-- effect once a recruiter explicitly flips it on in the Filters tab, and only
-- when that project actually has target companies configured (an empty list
-- means nothing to gate on, so the check is skipped even if this is true —
-- see app/api/screen-resumes/route.ts's score()).
--
-- IMPORTANT — run this BEFORE deploying the code that reads/writes it.
-- Kept OUT of the shared listProjects()/getProject() select in
-- lib/projects.ts, same Migration Sequencing rule as every other deferred
-- column this project uses (see exclude_from_fit_suggestions's migration for
-- the fuller rationale — a column referenced in a shared, heavily-used select
-- before its migration runs caused a real app-wide outage on 2026-07-09).
-- Read via an isolated, single-purpose helper (getProjectTargetCompanyGate in
-- lib/projects.ts) that fails closed to "gate off" on any error, including
-- this column not existing yet — so nothing breaks either way, the toggle
-- just silently does nothing until this migration runs.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS require_target_company_match boolean NOT NULL DEFAULT false;

-- No backfill needed — every existing project defaults to false (gate off),
-- matching current behavior exactly.
