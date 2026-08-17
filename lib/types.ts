export type Recommendation = "proceed" | "decline";

// "interview" removed 2026-07-15 — Screening is now the container status for
// the entire TA -> L1 -> L2 -> In-Person -> Offer/Reject arc (TrackerStage,
// below), rather than a separate top-level status a candidate moves into.
// Existing DB rows are backfilled from "interview" to "screening" by
// supabase-migration-backfill-interview-status.sql — run that BEFORE
// deploying this change (see decisions-log.md, 2026-07-15).
// "transferred" added 2026-07-29 (Vlad's ask: "add an option to transfer
// the candidate to another project from the status dropdown").
// CORRECTION, same day: this comment originally claimed the value itself
// needed no migration since screenings.status is a plain text column, not
// a Postgres enum — true of the column TYPE, but wrong about there being
// nothing else to migrate. A live test hit "violates check constraint
// screenings_status_check" — a CHECK constraint (predates this repo's
// migration-file convention, added directly via the Supabase dashboard)
// restricts status to a fixed value list independently of the column
// type. Fixed by supabase-migration-status-transferred-check.sql, which
// MUST run before this status value can actually be written. See
// supabase-migration-transfer-to-project.sql for the two separate pointer
// columns (transferredToProjectId/transferredToScreeningId) this status
// also relies on.
// Supersedes the earlier, purely-informational "Moved to X" Pipeline badge
// (findBetterFitMatches, removed same day) — Vlad: once a real Transfer
// action exists, showing that passive guess alongside it is redundant.
//
// "transferred" is no longer WRITTEN as of 2026-08-02 (Vlad's ask: "I don't
// want to show the transferred status of the candidate in the status
// dropdown since i want to archive the candidate of that project that was
// transferred") — transferScreeningToProject() (lib/screenings.ts) now sets
// the original screening's status to "archived" with archiveReason
// "Transferred" instead. The transferred_to_project_id/
// transferred_to_screening_id pointer columns are unchanged and still power
// the "view destination" link (StatusStageControl's showTransferredLink,
// now keyed off those columns directly rather than this status value). The
// "transferred" value itself stays in the type/array only so any row
// written before this date (or a database that hasn't run
// one-off-backfill-transferred-status-to-archived.sql yet) still renders
// without breaking — never pick it as a new value.
export type CandidateStatus = "new_applicant" | "recruiter_screen" | "contacted" | "screening" | "archived" | "transferred";

export const CANDIDATE_STATUSES: CandidateStatus[] = [
  "new_applicant",
  "recruiter_screen",
  "contacted",
  "screening",
  "archived",
  "transferred",
];

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  new_applicant: "New Applicant",
  recruiter_screen: "Recruiter Screen",
  contacted: "Contacted",
  screening: "Screening",
  archived: "Archived",
  transferred: "Transferred",
};

// Fixed reason list for archived candidates — Vlad's ask, 2026-07-15,
// mirroring how the Reject tracker stage captures reject_reason (see
// TrackerEntry.rejectReason below). Unlike rejectReason (free text, only
// shown once a candidate reaches the Reject stage), this is a fixed set of
// options since Archived is reachable from anywhere, including candidates
// who never entered the Tracker (e.g. auto-archived below the score
// threshold at save time). Stored on `screenings.archive_reason` — see
// supabase-migration-archive-reason.sql. Not yet wired into the shared
// SCREENING_COLUMNS select (lib/screenings.ts) — see that migration's
// header comment for why.
export const ARCHIVE_REASONS = [
  "Tech skills",
  "Domain knowledge",
  "Failed cross-reference check",
  "Not interested",
  "Role alignment",
  // Added 2026-08-02 — set automatically (never picked manually in the
  // normal flow) when transferScreeningToProject() archives the ORIGINAL
  // screening on a successful transfer, replacing what used to be a
  // separate "transferred" status value (see CandidateStatus's own comment
  // below for why). Still a real, pickable option here rather than free
  // text so it renders correctly selected — same precedent as
  // DEFAULT_AUTO_ARCHIVE_REASON below.
  "Transferred",
] as const;

/**
 * Reason auto-filled on screenings saved directly as "archived" for falling
 * below the project's score threshold (see saveScreening's auto-archive
 * branch, lib/screenings.ts) — a real 5th ARCHIVE_REASONS option (not free
 * text) so it renders correctly selected in the picker instead of showing
 * blank, and a recruiter can still change it to one of the other 4 reasons
 * later if they review the candidate and a more specific reason applies.
 * Corrected 2026-07-17 — an earlier reconstruction pass used "Below score
 * threshold" here, which isn't in ARCHIVE_REASONS at all and rendered
 * unselected in the picker; Claude Code's build-verification pass caught it.
 */
export const DEFAULT_AUTO_ARCHIVE_REASON: (typeof ARCHIVE_REASONS)[number] = "Role alignment";

// ── Tracker ──────────────────────────────────────────────────────────────────

export type TrackerStage = "TA" | "L1" | "L2" | "In-Person" | "Offer" | "Reject";

export const TRACKER_STAGES: TrackerStage[] = ["TA", "L1", "L2", "In-Person", "Offer", "Reject"];

export interface TrackerEntry {
  screeningId: number;
  candidateName: string;
  fileName: string;
  score: number;
  jobDescription: string;
  stage: TrackerStage;
  leverId: string;
  company: string;
  role: string;
  expectedLevel: string;
  /** Where the candidate is based — manually entered in the Tracker drawer. Added 2026-07-15. */
  location: string;
  stepsCompleted: string;
  comments: string;
  immigration: string;
  onHold: boolean;
  onHoldReason: string;
  /** Reason captured when stage moves to "Reject" — mirrors onHoldReason. */
  rejectReason: string;
  scheduled: boolean;
  interviewDate?: string;
  orderIndex: number;
  createdAt: string;
}

// ── Credibility assessment ───────────────────────────────────────────────────

export interface CredibilityRow {
  field: string;
  resume: string;
  crossRef: string;
  /**
   * Model scratch space, generated BEFORE status in the tool schema —
   * forces the arithmetic/reasoning for a row (especially the education
   * year-subtraction rule) to happen before the status decision, not after.
   * Added 2026-07-15 after live-testing found Claude filling this same
   * reasoning into `note` (which comes after `status` in field order) and
   * correctly computing e.g. "2024−2023=1, in range, match" there — but
   * still emitting status: "discrepancy" anyway, because by the time it
   * generated `note` the `status` field was already committed. Not surfaced
   * in the UI (CredibilitySection.tsx never reads it) — purely a generation-
   * order fix, not a new user-facing field.
   */
  reasoning?: string;
  status: "match" | "discrepancy" | "cannot_verify";
  note?: string;
  /**
   * Only meaningful when status === "discrepancy". Added 2026-07-15 to fix
   * over-flagging (title phrasing, staffing-agency-vs-client naming, LinkedIn's
   * month-only date granularity, education year-vs-range comparisons were all
   * being flagged as full "discrepancy" rows with no way to tell them apart
   * from a genuinely different employer or a real multi-month gap).
   * "material" = a real, hard-to-explain mismatch worth a follow-up question.
   * "minor" = explainable by common resume/LinkedIn formatting differences —
   * still shown to the recruiter, but doesn't count toward scoreDelta.
   */
  severity?: "material" | "minor";
}

export type CredibilitySignal = "clean" | "minor_concerns" | "significant_concerns";

/**
 * LinkedIn profile activity signals extracted when the cross-reference
 * document is a LinkedIn PDF. Not present for resume-vs-resume comparisons.
 * Phase 2.4 — revised from skill-alignment to activity assessment.
 */
export interface LinkedInSignals {
  /** Verdict derived from the signals below — code-readable summary. */
  activity: "active" | "moderate" | "minimal";
  /** Connection count as shown in the PDF, e.g. "500+" or "47". Omitted if not visible. */
  connectionCount?: string;
  /** Number of written recommendations received. 0 if section absent. */
  recommendationCount: number;
  /** True if the About/Summary section exists and has meaningful content. */
  hasSummary: boolean;
  /** Most recent certification or LinkedIn Learning course date (YYYY-MM), if visible. */
  recentCertDate?: string;
}

export interface CredibilityAssessment {
  rows: CredibilityRow[];
  trajectoryNote: string;
  industryNote: string;
  resumeDelta?: string;
  overallSignal: CredibilitySignal;
  /**
   * Net points to apply to the resume's fit score to reflect credibility
   * findings — scoreDeduction + scoreBonus below. Was always <= 0 before
   * 2026-07-29; can now be positive when resolvedConcerns outweighs any
   * deduction. Both components are computed deterministically in code
   * (computeCredibilityScoreDelta / computeCredibilityScoreBonus in
   * lib/assessCredibility.ts), NOT decided by the model directly, so the
   * number stays consistent and auditable across runs. Each side is
   * independently capped so a credibility check can dock or credit a score
   * but never invert it outright. Added 2026-07-15 (deduction only), Vlad's
   * ask — shown as a split-color ring on ScoreBadge.
   */
  scoreDelta?: number;
  /** Always <= 0. The discrepancy-driven component of scoreDelta — see computeCredibilityScoreDelta. */
  scoreDeduction?: number;
  /**
   * Always >= 0. The resolved-concern-driven component of scoreDelta — see
   * computeCredibilityScoreBonus. Only meaningful when originalConcerns was
   * passed into assessCredibility(); 0 otherwise.
   */
  scoreBonus?: number;
  /**
   * Original screening concerns (result.concerns) that this cross-reference
   * document resolved with concrete evidence — see resolvedConcerns in
   * CREDIBILITY_TOOL for the exact bar. Absent (not just empty) when no
   * original concerns were passed in, matching the pre-2026-07-29 response
   * shape. Added 2026-07-29, Vlad's ask.
   */
  resolvedConcerns?: { concern: string; explanation: string }[];
  /** Populated only when the cross-reference document is a LinkedIn profile PDF. Phase 2.4. */
  linkedInSignals?: LinkedInSignals;
}

export interface CandidateResult {
  id?: number;
  fileName: string;
  candidateName: string;
  score: number;
  mustHaveScore?: number;
  niceToHaveScore?: number;
  summary: string;
  strengths: string[];
  concerns: string[];
  careerTrajectory?: string;
  /**
   * Mirrors ScreeningRecord.currentCompany/currentTitle/totalExperienceSummary/
   * linkedinUrl — present here because scoreCandidate.ts (do-not-touch
   * exception, 2026-08-06, Vlad's explicit sign-off) now generates these in
   * the same call as scoring, so saveScreening() reads them straight off
   * this result rather than a separate lookup. See ScreeningRecord's own
   * comments on each field for the full "why."
   */
  currentCompany?: string;
  currentTitle?: string;
  totalExperienceSummary?: string;
  linkedinUrl?: string;
  /**
   * Target-company score boost, 2026-08-07 (Vlad's ask: "add companies in
   * there that would increase the score if it matches with the candidate's
   * resume"). Set by saveScreening() (lib/screenings.ts) — a deterministic,
   * code-computed match (lib/targetCompanyBoost.ts), NOT part of
   * scoreCandidate.ts's own judgment, so it's auditable independent of the
   * model. Present here (not just ScreeningRecord) for the same reason
   * archiveReason is — the post-screening ResultCard predates a real
   * ScreeningRecord read-back. Empty array = checked, no match. Undefined =
   * no target companies configured for this project, boost not evaluated.
   */
  targetCompanyMatches?: string[];
  /**
   * JD checklist evaluation, 2026-08-17 (Vlad's ask) — mirrors
   * ScreeningRecord.checklistEvaluation, present here for the same reason
   * targetCompanyMatches is (the post-screening ResultCard predates a real
   * ScreeningRecord read-back). Set by saveScreening() from the caller's
   * pre-computed evaluateChecklist() result — see lib/evaluateChecklist.ts.
   * Undefined = no checklist configured for this project, not evaluated.
   */
  checklistEvaluation?: ChecklistEvaluation;
  recommendation: Recommendation;
  status?: CandidateStatus;
  credibility?: CredibilityAssessment;
  /**
   * Manually-triggered fraud risk check result — mirrors
   * ScreeningRecord.fraudRisk, present here too for the same reason
   * archiveReason is (the post-screening ResultCard predates a real
   * ScreeningRecord read-back). See FraudRiskAssessment. Added 2026-07-30.
   */
  fraudRisk?: FraudRiskAssessment;
  /**
   * Mirrors ScreeningRecord.archiveReason — needed here too because the
   * post-screening ResultCard (app/projects/[id]/page.tsx's Screen tab) lets
   * a recruiter archive a candidate right after scoring, before it's a
   * ScreeningRecord read back from the DB. Added 2026-07-15.
   */
  archiveReason?: string;
  /** Notes field, added 2026-07-16 in place of the removed Generate Question tool — mirrors ScreeningRecord.notes so it can be edited immediately post-screening. */
  notes?: string;
  /** Mirrors ScreeningRecord.linkedInMode — lets the post-screening card show the LinkedIn icon without waiting for a reload. Added 2026-07-16. */
  linkedInMode?: boolean;
  /**
   * Real-content LinkedIn detection, independent of linkedInMode (which is
   * the recruiter's manual "Sourced" channel toggle, not a file-format
   * check). True/false once computed via lib/assessCredibility.ts's
   * detectLinkedIn() against the actual extracted resume text; undefined
   * when not yet computed (older rows, or migration not yet run) — the icon
   * treats undefined the same as true so it doesn't visually change until
   * real data exists. Added 2026-07-31 (Vlad's ask). See
   * supabase-migration-resume-is-linkedin.sql.
   */
  resumeIsLinkedIn?: boolean;
  /** Mirrors ScreeningRecord.agencyName — same reload-avoidance reason as linkedInMode above. Added 2026-07-20. */
  agencyName?: string;
  /**
   * Fraud/match signals mirrored from ScreeningRecord so they can render on
   * the post-screening ResultCard immediately, not just after a reload —
   * saveScreening already computes these synchronously at save time.
   * Added 2026-07-16.
   */
  duplicateFlag?: boolean;
  duplicateMatchId?: number;
  duplicateMatchCandidateName?: string;
  historyAlertType?: "previously_seen" | "known_fraud_pattern";
  historyAlertMatchId?: number;
  historyAlertMatchProjectId?: number;
  historyAlertMatchProjectName?: string;
  historyAlertMatchCandidateName?: string;
  /**
   * Cross-project NAME match (team-wide), added 2026-07-27 — see
   * lib/screenings.ts's findCrossProjectNameMatch(). Distinct from
   * historyAlertType above: this is a pure candidate_name comparison, no
   * Claude call, no fraud implication — just "this same name was also
   * screened for a different role in your team." Deliberately ephemeral:
   * only ever set here on the live screening response, never persisted to
   * the DB or read back via rowToRecord() — so this is NOT on
   * ScreeningRecord, only CandidateResult. A reload of the Pipeline/All
   * Candidates page won't show it; it's a during-screening mention only.
   */
  crossProjectNameMatchScreeningId?: number;
  crossProjectNameMatchProjectId?: number;
  crossProjectNameMatchProjectName?: string;
  /** The matched screening's own score — added 2026-07-27 (Vlad's ask: show a score alongside "Also screened in [project]"), same ephemeral/not-persisted treatment as the three fields above it. */
  crossProjectNameMatchScore?: number;
  /**
   * Mirrors ScreeningRecord.blacklisted/blacklistReason — needed here too so
   * the checkbox on StatusStageControl (rendered via the post-screening
   * ResultCard) reflects state immediately without a reload, same reason
   * archiveReason is mirrored above. Added 2026-07-31.
   */
  blacklisted?: boolean;
  blacklistReason?: string | null;
  /**
   * System-wide blacklist warning surfaced during screening (before this
   * candidate is even saved) — a name match against lib/screenings.ts's
   * listBlacklist(), computed client-side in ScreenTab the same way
   * rejectionHistory/crossProjectNameMatch are. Deliberately ephemeral, same
   * as crossProjectNameMatch* above: never persisted, only ever set on the
   * live screening response. Added 2026-07-31.
   */
  blacklistMatch?: BlacklistEntry;
}

export interface ScreenResumesResponse {
  results: CandidateResult[];
}

export interface ScreenResumesError {
  fileName: string;
  error: string;
}

// ── Pre-screen duplicate check ───────────────────────────────────────────────
// See app/api/screen-resumes/check-existing/route.ts — runs before any file
// reaches the scoring route, so an exact re-upload never costs a Claude call.

export interface CheckExistingResult {
  fileName: string;
  status: "new" | "duplicate";
  /**
   * The uploaded file's own resume_content_hash — computed here regardless of
   * "new"/"duplicate" status (it's free, already computed for the same-project
   * exact-match check above). Threaded through to the client so the post-score
   * rejection-history name match (findRejectionMatches in
   * app/projects/[id]/page.tsx) can check for exact-resume corroboration, not
   * just a name coincidence. Added 2026-07-29, see decisions-log.md.
   */
  resumeContentHash?: string;
  existing?: {
    id: number;
    candidateName: string;
    fileName: string;
    score: number;
    mustHaveScore?: number;
    niceToHaveScore?: number;
    summary: string;
    strengths: string[];
    concerns: string[];
    careerTrajectory?: string;
    recommendation: Recommendation | null;
    /**
     * Current pipeline status of the already-saved candidate, shown as a
     * chip on AlreadyScreenedCard so a recruiter re-uploading a resume can
     * see at a glance where that candidate already stands, without needing
     * to switch to the Pipeline tab. Added 2026-07-17.
     */
    status: CandidateStatus;
    /** Only meaningful when status === "archived" — mirrors ScreeningRecord.archiveReason. */
    archiveReason?: string;
  };
}

/**
 * A candidate already saved in the project, keyed by normalized name — the
 * only thing hashResumeText can't catch (two genuinely different resume
 * files that turn out to name the same person). Compared client-side AFTER
 * scoring, since candidate name doesn't exist before it.
 */
export interface ExistingCandidateRef {
  id: number;
  candidateName: string;
}

/**
 * System-wide (any project, any team) rejection history — Teti's request,
 * 2026-07-10. Deliberately not scoped like every other duplicate/match
 * signal in this app: a recruiter should see if a name-matched candidate
 * was already rejected somewhere else, regardless of team boundaries.
 * Compared client-side after scoring, same pattern as ExistingCandidateRef.
 */
export interface RejectionHistoryEntry {
  candidateName: string;
  projectName: string | null;
  reason: string | null;
  /**
   * The rejected screening's resume_content_hash, null if it predates that
   * column or never computed successfully. Lets a match be corroborated by
   * more than name text alone — see `confidence` below.
   */
  contentHash: string | null;
  /**
   * Set only once this entry has actually been matched against a freshly
   * scored candidate (findRejectionMatches, app/projects/[id]/page.tsx) —
   * absent on the raw baseline list. "name_and_resume" means the uploaded
   * file's own content hash matches this rejected screening's hash exactly
   * (very high confidence, same document); "name_only" means just the
   * normalized name matched, which a common name can trigger on two
   * different people. Added 2026-07-29 in response to the meeting-prep
   * audit's flagged risk — normalizeCandidateName (lib/resumeContentHash.ts)
   * is deliberately loose, and an earlier filename-based corroboration idea
   * was already retired 2026-07-15 for producing false positives on generic
   * filenames, so content-hash is the one reliable secondary signal
   * available without adding new scope. See decisions-log.md.
   */
  confidence?: "name_only" | "name_and_resume";
}

/**
 * System-wide (any project, any team) blacklist — Vlad's ask, 2026-07-31:
 * "When a person is archived, let the recruiter blacklist the person if
 * needed, which will be shown during the screening if the same person is
 * applying for a different role." Deliberately not team-scoped, same
 * precedent as RejectionHistoryEntry above — a blacklisted candidate is
 * flagged for every recruiter, not just the one who blacklisted them.
 * Compared client-side after scoring, same name-match pattern as
 * RejectionHistoryEntry (see findBlacklistMatches, app/projects/[id]/page.tsx).
 */
export interface BlacklistEntry {
  candidateName: string;
  reason: string | null;
  /** The blacklisted screening's own project, for context in the warning banner. */
  projectName: string | null;
  /** Same corroboration idea as RejectionHistoryEntry.contentHash — lets a match be upgraded from a name coincidence to "this is the same document." */
  contentHash: string | null;
  /** Set only once matched against a freshly scored candidate — see RejectionHistoryEntry.confidence for the identical reasoning. */
  confidence?: "name_only" | "name_and_resume";
}

export interface ScreeningRecord {
  id: number;
  candidateName: string;
  fileName: string;
  score: number;
  mustHaveScore?: number;
  niceToHaveScore?: number;
  summary: string;
  strengths: string[];
  concerns: string[];
  careerTrajectory?: string;
  recommendation: Recommendation | null;
  status: CandidateStatus;
  statusUpdatedAt?: string;
  /**
   * Why this candidate was archived — one of ARCHIVE_REASONS, or undefined
   * if never set. Only meaningful when status === "archived". Added
   * 2026-07-15; not yet in the shared SCREENING_COLUMNS select (see
   * supabase-migration-archive-reason.sql), so this will read as undefined
   * until that follow-up wiring lands post-migration.
   */
  archiveReason?: string;
  /**
   * Blacklist, 2026-07-31 (Vlad's ask) — set via a checkbox alongside the
   * archive-reason picker (StatusStageControl.tsx). Meaningful regardless of
   * current status (a blacklisted candidate stays blacklisted even if their
   * status is later changed off "archived"). Deliberately NOT in the shared
   * SCREENING_COLUMNS select yet — same deferred pattern as archiveReason
   * above, see supabase-migration-blacklist.sql.
   */
  blacklisted?: boolean;
  blacklistReason?: string | null;
  /**
   * Archive Fits, 2026-07-30 (Vlad's ask) — short role/title suggestions for
   * where this candidate would actually fit, independent of any specific
   * project's JD. Auto-generated at archive time for role-mismatch reasons
   * (see lib/generateRoleFit.ts), plus anything a recruiter adds manually.
   * Deliberately NOT in the shared SCREENING_COLUMNS select — same deferred
   * pattern as archiveReason above, see supabase-migration-archive-fits.sql.
   * Only ever read/written via the dedicated /api/history/[id]/role-fits and
   * /api/projects/[id]/archive-fits routes.
   */
  suggestedRoleFits?: string[];
  /**
   * Current/most-recent employer + title, added 2026-08-04 (Vlad's ask: a
   * "Current Company" / "Current Title" column on the FunnelView Excel
   * export). Extracted alongside careerTrajectory — as of 2026-08-06 this
   * happens both in the main scoring call (lib/scoreCandidate.ts, do-not-
   * touch exception — see memory/decisions-log.md) for new screenings going
   * forward, AND in lib/generateTrajectory.ts for the "Regenerate
   * trajectories" backfill (app/api/screenings/regenerate-trajectories/
   * route.ts) covering already-screened candidates. Deliberately NOT in
   * the shared SCREENING_COLUMNS select — same deferred pattern as
   * archiveReason above, see supabase-migration-current-role.sql. Only ever
   * written via updateScreening() (a separate, best-effort call — see
   * saveScreening()'s own comment for why it can't be bundled into the main
   * insert) and read via FunnelView's own isolated, per-column-resilient
   * query (lib/funnelview/data.ts).
   */
  currentCompany?: string;
  currentTitle?: string;
  /**
   * Short, facts-only summary — total years, domain, seniority — 1 sentence
   * preferred, 2 sentences absolute max. Added 2026-08-04 for the FunnelView
   * export's "Total experience" column after Vlad asked for it to be much
   * shorter than careerTrajectory's own closing paragraph, then tightened
   * further same day. Same deferred-column pattern as currentCompany above.
   */
  totalExperienceSummary?: string;
  /**
   * LinkedIn profile URL, added 2026-08-06 (Vlad's ask: a "LinkedIn" link
   * column on the FunnelView Excel export). Auto-extracted from the resume's
   * own contact info/text — NOT every resume lists one, so this is
   * frequently absent even for fully-backfilled candidates; that's expected,
   * not a bug. Same deferred-column pattern and generation paths as
   * currentCompany above.
   */
  linkedinUrl?: string;
  /**
   * Target-company score boost, 2026-08-07 (Vlad's ask). Which of the
   * project's configured "score boost companies" (JD Analyzer, reuses
   * JDAnalysis.wide/narrow.targetCompanies) matched this candidate's resume
   * text — see lib/targetCompanyBoost.ts. Same deferred-column pattern as
   * currentCompany above (supabase-migration-target-company-boost.sql).
   * Written via saveScreening()'s existing best-effort secondary update,
   * never the main insert, so a screening can never fail just because this
   * migration hasn't run.
   */
  targetCompanyMatches?: string[];
  /**
   * JD Checklist evaluation, 2026-08-15 — which of the project's checklist
   * items fired for this candidate, and why. Same deferred-column pattern
   * as targetCompanyMatches above (supabase-migration-checklist.sql).
   * Undefined for any project with no checklist configured — the whole
   * mechanism is opt-in, a project with no checklist scores exactly as it
   * did before this feature existed.
   */
  checklistEvaluation?: ChecklistEvaluation;
  jobDescription: string;
  resumeMimeType: string;
  linkedInMode: boolean;
  /**
   * Set only when this candidate came in via an agency — free text, the
   * agency's name. Undefined/empty for Applicant and LinkedIn sources. See
   * lib/sourceType.ts's getSourceType() for how the three source types
   * (Applicant/LinkedIn/Agency) derive from this + linkedInMode. Added
   * 2026-07-20. UNLIKE archiveReason's deferred-SCREENING_COLUMNS pattern,
   * this column IS wired into the write path unconditionally (every
   * saveScreening() insert includes it, not just agency-sourced saves) — so
   * deferring the read-side wiring wouldn't actually reduce deploy-order
   * risk here, the insert breaks everything regardless if the column is
   * missing. supabase-migration-agency-source.sql MUST run before this
   * deploys, full stop — see that file's header.
   */
  agencyName?: string;
  /**
   * Real-content LinkedIn detection — see CandidateResult.resumeIsLinkedIn
   * for the full explanation (this is the same field, mirrored here for the
   * read-back-from-DB shape). Deferred/isolated, same pattern as
   * archiveReason above — see supabase-migration-resume-is-linkedin.sql.
   */
  resumeIsLinkedIn?: boolean;
  flagged: boolean;
  flagNote?: string;
  notes?: string;
  leverUrl?: string;
  credibility?: CredibilityAssessment;
  /**
   * Manually-triggered fraud risk check result, only ever offered at score
   * >= 75 (FraudRiskChecker). Deliberately NOT in the shared SCREENING_COLUMNS
   * select yet — see supabase-migration-fraud-calibration.sql's header for
   * the deferred-wiring plan this follows (same as archiveReason before it).
   * Added 2026-07-30.
   */
  fraudRisk?: FraudRiskAssessment;
  photoUrl?: string;
  linkedInPdfPath?: string;
  interviewQuestions?: string[];
  projectId?: number;
  duplicateFlag: boolean;
  duplicateMatchId?: number;
  /** Phase 1.4 — cross-project fingerprint match within the same team. */
  historyAlertType?: "previously_seen" | "known_fraud_pattern";
  historyAlertMatchId?: number;
  historyAlertMatchProjectId?: number;
  historyAlertMatchProjectName?: string;
  historyAlertMatchCandidateName?: string;
  /**
   * Same-project candidate-name match — a different resume file for a
   * candidate with the same name already exists in this project, but the
   * content doesn't match closely enough for duplicateFlag (Phase 1.1) to
   * have caught it. Informational, not a fraud signal.
   */
  nameMatchId?: number;
  previousStatus?: CandidateStatus;
  /**
   * Who screened this candidate — mirrors FunnelCandidate's recruiterId/
   * recruiterEmail naming (lib/funnelview/types.ts). recruiterId is the raw
   * auth user id from screenings.user_id; recruiterEmail is resolved via
   * getRecruiterEmailMap() in listScreenings/getScreeningsByIds, falling
   * back to the id if the user has no email or the lookup fails. Added
   * 2026-07-20 for the Pipeline tab's recruiter filter.
   */
  recruiterId?: string;
  recruiterEmail?: string;
  /**
   * Groups screenings saved together in one POST /api/screen-resumes call —
   * a plain client-generated UUID, not a foreign key (see
   * supabase-migration-batch-id.sql). Powers the durable
   * /projects/[id]/batches/[batchId] page (Vlad's ask, 2026-07-28: a
   * bookmarkable, cross-device way back to "the batch I just screened",
   * since sessionStorage only lives in one browser tab and this app is
   * explicitly used across two machines). Undefined for screenings saved
   * before this column existed, or saved outside a batch context (e.g. a
   * single "Transfer to project" via save-one).
   */
  batchId?: string;
  /**
   * Set only when status === "transferred" — where this candidate went
   * (Vlad's ask, 2026-07-29). transferredToScreeningId points at the real,
   * separately-scored screening row created in the destination project
   * (transferScreeningToProject(), lib/screenings.ts) — powers the small
   * "view" link next to the Transferred status pill
   * (components/StatusStageControl.tsx), which goes straight to
   * /candidates/[transferredToScreeningId]. transferredToProjectName is
   * resolved via a separate, isolated enrichment query
   * (enrichTransferInfo) — see supabase-migration-transfer-to-project.sql
   * for why these three fields are deliberately NOT in the shared
   * SCREENING_COLUMNS select.
   */
  transferredToProjectId?: number;
  transferredToProjectName?: string;
  transferredToScreeningId?: number;
  createdAt: string;
}

// ── Full tracker data (all tracker table fields) ─────────────────────────────

export interface FullTrackerData {
  stage?: TrackerStage;
  company?: string;
  role?: string;
  expectedLevel?: string;
  /** Where the candidate is based — manually entered in the Tracker drawer. Added 2026-07-15. */
  location?: string;
  stepsCompleted?: string;
  comments?: string;
  immigration?: string;
  onHold?: boolean;
  onHoldReason?: string;
  rejectReason?: string;
  scheduled?: boolean;
  interviewDate?: string;
  previousStage?: TrackerStage;
}

// ── Calibration ───────────────────────────────────────────────────────────────

export type CalibrationLabel = "good" | "bad";

export interface CalibrationExample {
  id: number;
  label: CalibrationLabel;
  note: string | null;
  fileName: string;
  resumeMimeType: string;
  extractedText: string;
  createdAt: string;
}

// ── Fraud calibration ────────────────────────────────────────────────────────
// Added 2026-07-30, Vlad's ask: a system-wide (not project-scoped, unlike
// CalibrationExample above) library of real, confirmed-fraudulent resumes,
// built up over time from the RejectionCard's "Suspected fraud" checkbox.
// lib/assessFraudRisk.ts few-shots against these the same way scoreCandidate.ts
// few-shots against CalibrationExample — see that file for the parallel.
// See supabase-migration-fraud-calibration.sql for the table this mirrors.

/**
 * Broad category of the confirmed fraud, picked by the recruiter when
 * flagging a rejection as fraud. Deliberately a small fixed set (not free
 * text) so lib/assessFraudRisk.ts can group/weight examples by type instead
 * of treating every past case as equally relevant to a new resume.
 */
export type FraudPatternType =
  | "fabricated_experience"
  | "inflated_title"
  | "fake_employer"
  | "education_mismatch"
  | "timeline_gap_concealment"
  | "boilerplate_resume"
  | "other";

export const FRAUD_PATTERN_TYPES: FraudPatternType[] = [
  "fabricated_experience",
  "inflated_title",
  "fake_employer",
  "education_mismatch",
  "timeline_gap_concealment",
  "boilerplate_resume",
  "other",
];

export const FRAUD_PATTERN_TYPE_LABELS: Record<FraudPatternType, string> = {
  fabricated_experience: "Fabricated experience",
  inflated_title: "Inflated title",
  fake_employer: "Fake employer",
  education_mismatch: "Education mismatch",
  timeline_gap_concealment: "Concealed timeline gap",
  boilerplate_resume: "Boilerplate / résumé-mill",
  other: "Other",
};

/**
 * One specific fabricated point on a confirmed-fraud resume — a resume can
 * have more than one, which is why this is an array on the example rather
 * than a single freeform note (Vlad's ask: "hit specific points from the
 * resume that the system can identify").
 */
export interface FraudCalibrationClaim {
  /** The specific claim as it appears on the resume, e.g. "Senior Engineer at Google, 2019-2022". */
  claimText: string;
  /** Why this claim was confirmed fabricated — the decision-maker's comment from the Rejection card. */
  explanation: string;
}

export interface FraudCalibrationExample {
  id: number;
  patternType: FraudPatternType;
  claims: FraudCalibrationClaim[];
  fileName: string;
  resumeMimeType: string;
  extractedText: string;
  /** Traceability only — which real rejection this came from. Not a live reference; the source screening may later be deleted or archived without affecting this example. */
  sourceScreeningId?: number;
  createdAt: string;
}

/** One risk signal lib/assessFraudRisk.ts found on a NEW resume, citing which calibration pattern it resembles. */
export interface FraudRiskSignal {
  /** The specific text/claim on the resume being screened that triggered this signal. */
  claimText: string;
  patternType: FraudPatternType;
  /** Why this resembles a known fraud pattern — cites age/graduation year/role-gap reasoning per Vlad's ask. */
  explanation: string;
  /** ID of the confirmed-fraud calibration example this most closely resembles, if any. Absent when the signal is based purely on internal resume inconsistency with no close match on file. */
  matchedExampleId?: number;
}

export type FraudRiskLevel = "low" | "moderate" | "high";

/**
 * Result of a manually-triggered fraud risk check (only offered at score
 * >= 75, per Vlad's ask — kept manual and opt-in so it can never push a
 * batch screening run over the 60s route timeout). Persisted to
 * screenings.fraud_risk once supabase-migration-fraud-calibration.sql has
 * run — see that migration's header for the deferred-wiring plan.
 */
export interface FraudRiskAssessment {
  signals: FraudRiskSignal[];
  /**
   * 0-100, deterministic — computed in code by computeFraudRiskScore()
   * (lib/assessFraudRisk.ts) from the model-cited signals, NOT invented by
   * the model directly, same principle as CredibilityAssessment.scoreDelta.
   * This is the "percentage" from Vlad's original ask ("gives a percentage
   * or warning of fake experience").
   */
  riskScore: number;
  /** Deterministic bucket of riskScore — see fraudRiskLevelFromScore(). Powers the risk badge's color. */
  overallRisk: FraudRiskLevel;
  summary: string;
  createdAt: string;
}

// ── Projects ─────────────────────────────────────────────────────────────────

export type ProjectStatus = "active" | "archived" | "closed";

export interface Project {
  id: number;
  name: string;
  jobDescription: string;
  jdAnalysis: JDAnalysis | null;
  status: ProjectStatus;
  /** Minimum score to save to pipeline history. Default 45. Range 0–100. */
  scoreThreshold: number;
  teamId?: number;
  /**
   * Opt this role out of Cross-Project Fit Suggestion (Phase 2.1) — when
   * true, a candidate who scores below threshold on some OTHER project will
   * never have this project checked/suggested as a better fit for them.
   * Default false (included), added 2026-07-30, Vlad's ask. Deliberately
   * NOT in the shared listProjects()/getProject() select — see
   * supabase-migration-exclude-from-fit-suggestions.sql's header for the
   * deferred-wiring rationale. Only populated when explicitly fetched via
   * getProjectFitExclusion()/getFitExclusionMap() (lib/projects.ts); absent
   * (not just false) means "not checked," not "confirmed included."
   */
  excludeFromFitSuggestions?: boolean;
  /**
   * JD checklist definition, 2026-08-17 — same "deliberately NOT in the
   * shared select" pattern as excludeFromFitSuggestions above. Only
   * populated when explicitly fetched via getProjectChecklist()
   * (lib/projects.ts), e.g. app/api/projects/[id]/route.ts's GET handler.
   * `undefined` means "not checked" (e.g. this Project came from
   * listProjects()); `null` means genuinely checked and no checklist is
   * configured for this project yet.
   */
  checklist?: ProjectChecklist | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends Project {
  screeningCount: number;
  /** Candidates with status "screening" — the container status for the whole TA/L1/L2/In-Person/Offer arc as of 2026-07-15. Renamed from interviewCount when "interview" was removed from CandidateStatus. */
  inTrackerCount: number;
  teamName?: string;
}

export interface FilterConfig {
  jobTitlesBoolean: string;
  jobTitleToggle: "Current only" | "Current or past";
  location: string;
  workplaceType: string[];
  keywords: string;
  seniority: string[];
  yearsExperience: string;
  yearsInCurrentPosition: string;
  yearsInCurrentCompany: string;
  industries: string[];
  companySize: string[];
  targetCompanies: string[];
  spotlights: string[];
  mustHaveFilters: string[];
}

export interface JDAnalysis {
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  jobTitles: string[];
  jobFunctions: string[];
  rationale: string;
  wide: FilterConfig;
  narrow: FilterConfig;
  linkedInContext?: string;
}

/**
 * JD Checklist ("Trust badge"), 2026-08-15 (Vlad's ask) — enriches the
 * must-have/nice-to-have list into precise, individually-editable,
 * individually-reasoned checks. Generated once per JD analysis/re-analysis
 * by lib/generateChecklist.ts (a NEW, separate file — NOT an edit to
 * analyzeJD.ts, which is do-not-touch), then freely editable by the
 * recruiter on the project's Filters tab. Two categories, matching Vlad's
 * "Decrease score" / "Add score" framing: `decrease` items are soft-signal
 * gaps worth a deduction if genuinely unevidenced; `add` items are
 * reinforcing signals worth a bonus if genuinely evidenced. Deliberately
 * does NOT include a target-company-match item — that's already a separate,
 * shipped, deterministic mechanism (lib/targetCompanyBoost.ts); a checklist
 * item for it would double-count the same signal.
 */
export interface ChecklistItem {
  /** Stable id for editing/deleting one specific item without disturbing the rest — crypto.randomUUID() at creation time. */
  id: string;
  category: "decrease" | "add";
  /** Short, specific description of the check — e.g. "AWS Solutions Architect certification" or "Led a team of 3+ engineers". */
  label: string;
  /** Magnitude only (always positive) — category determines the sign when applied. */
  points: number;
}

export interface ProjectChecklist {
  items: ChecklistItem[];
  /** ISO timestamp of the last generate/regenerate — NOT updated by a manual item edit, only by re-running generation. */
  generatedAt: string;
}

/**
 * Per-candidate result of evaluating an existing ProjectChecklist against
 * one resume — lib/evaluateChecklist.ts. Deliberately NOT baked into
 * scoreCandidate.ts's prompt (do-not-touch) — runs as its own separate,
 * parallel call (same Promise.all pattern as generateFingerprint()) and the
 * resulting point deltas get applied deterministically in saveScreening(),
 * same "deterministic, not model-decided" pattern already proven by
 * lib/targetCompanyBoost.ts. `firedItemIds` is what actually drives the
 * score delta; `reasoning` is per-item, for the recruiter to read WHY,
 * matching this app's "case file not scorecard" principle everywhere else.
 */
export interface ChecklistItemResult {
  itemId: string;
  fired: boolean;
  reasoning: string;
  /**
   * label/category/points, 2026-08-17 — denormalized off the ChecklistItem
   * this result was evaluated against, captured at evaluation time (see
   * lib/evaluateChecklist.ts). Deliberate duplication, not a join: a
   * recruiter can edit or delete checklist items on the Filters tab after a
   * candidate was already screened against the old version — this result
   * should keep showing exactly what it was evaluated against (ResultCard's
   * checklist breakdown reads these fields directly, never looks the item
   * back up by id), not silently reflect whatever the checklist says today.
   */
  label: string;
  category: "decrease" | "add";
  points: number;
}

export interface ChecklistEvaluation {
  results: ChecklistItemResult[];
  /** Deterministic sum of fired items' points (decrease items negative, add items positive) — computed in code, not by the model. See computeChecklistScoreDelta. */
  scoreDelta: number;
}
