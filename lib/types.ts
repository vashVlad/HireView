export type Recommendation = "proceed" | "decline";

// "interview" removed 2026-07-15 — Screening is now the container status for
// the entire TA -> L1 -> L2 -> In-Person -> Offer/Reject arc (TrackerStage,
// below), rather than a separate top-level status a candidate moves into.
// Existing DB rows are backfilled from "interview" to "screening" by
// supabase-migration-backfill-interview-status.sql — run that BEFORE
// deploying this change (see decisions-log.md, 2026-07-15).
export type CandidateStatus = "new_applicant" | "recruiter_screen" | "contacted" | "screening" | "archived";

export const CANDIDATE_STATUSES: CandidateStatus[] = [
  "new_applicant",
  "recruiter_screen",
  "contacted",
  "screening",
  "archived",
];

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  new_applicant: "New Applicant",
  recruiter_screen: "Recruiter Screen",
  contacted: "Contacted",
  screening: "Screening",
  archived: "Archived",
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
   * Points to subtract from the resume's fit score to reflect credibility
   * findings — always <= 0. Computed deterministically in code from the
   * count of severity: "material" discrepancy rows (see
   * computeCredibilityScoreDelta in lib/assessCredibility.ts), NOT decided by
   * the model directly, so the number stays consistent and auditable across
   * runs. Capped so a credibility check can never invert a strong fit score.
   * Added 2026-07-15, Vlad's ask — shown as a split-color ring on ScoreBadge.
   */
  scoreDelta?: number;
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
  recommendation: Recommendation;
  status?: CandidateStatus;
  credibility?: CredibilityAssessment;
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
  jobDescription: string;
  resumeMimeType: string;
  linkedInMode: boolean;
  flagged: boolean;
  flagNote?: string;
  notes?: string;
  leverUrl?: string;
  credibility?: CredibilityAssessment;
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
