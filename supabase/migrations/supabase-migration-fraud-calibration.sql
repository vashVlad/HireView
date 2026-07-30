-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Fraud calibration examples + fraud risk column
-- Run this in Supabase SQL editor → Run
--
-- Vlad's ask, 2026-07-29 (meeting-prep audit follow-up): a Credibility
-- Checker exists (resume vs. a second document), but nothing "learns" from
-- confirmed real fraud cases the way scoreCandidate.ts's calibration_examples
-- table lets JD-fit scoring learn from real hiring decisions. This adds the
-- fraud-specific equivalent.
--
-- fraud_calibration_examples mirrors calibration_examples' storage pattern
-- (self-contained resume copy — resume_path/extracted_text — not a live FK
-- to screenings, so deleting/archiving old screenings can never break a
-- calibration example) but is deliberately system-wide, not project-scoped:
-- fraud patterns (a fabricated timeline, boilerplate résumé-mill phrasing)
-- aren't role-specific the way "good fit" is. source_screening_id is kept
-- purely for traceability (which real rejection this came from) — nothing
-- should join through it or assume the source screening still exists.
--
-- claims is a jsonb array of {claimText, explanation} — one entry per
-- specific fabricated point on that resume (a resume can have more than
-- one), not a single freeform note. This is what lib/assessFraudRisk.ts
-- actually few-shots against, so it needs to be structured and specific,
-- not a paragraph the model has to interpret loosely each time.
--
-- screenings.fraud_risk mirrors the existing `credibility` jsonb column
-- exactly (same shape of relationship: a manually-triggered check's result,
-- persisted so it survives a reload). Deliberately NOT added to the shared
-- SCREENING_COLUMNS select in lib/screenings.ts until this migration is
-- confirmed run — same deferred-wiring pattern already used for
-- archive_reason, see that migration's header comment for why.
--
-- IMPORTANT — run this BEFORE deploying the code that reads/writes these.
-- Both the calibration-save path and the fraud-risk-check path fail closed
-- (return [] / never save) rather than throwing until this has run, so nothing
-- breaks either way — the features just silently do nothing until it does.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fraud_calibration_examples (
  id                    bigserial primary key,
  pattern_type          text NOT NULL,
  claims                jsonb NOT NULL DEFAULT '[]',
  resume_path           text NOT NULL,
  resume_mime_type      text NOT NULL,
  extracted_text        text NOT NULL,
  source_screening_id   bigint,
  user_id               uuid,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fraud_calibration_examples_pattern_type_idx ON fraud_calibration_examples(pattern_type);
CREATE INDEX IF NOT EXISTS fraud_calibration_examples_created_at_idx ON fraud_calibration_examples(created_at);

ALTER TABLE screenings
  ADD COLUMN IF NOT EXISTS fraud_risk jsonb;

-- Existing screenings are unaffected — fraud_risk defaults to null, no
-- backfill needed. fraud_calibration_examples starts empty; it's only ever
-- useful once real confirmed-fraud cases are flagged into it via the
-- Rejection card's "Suspected fraud" checkbox.
