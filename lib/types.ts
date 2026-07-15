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
// supabase-migration-archive-reason.sql (confirmed run 2026-07-15).
export const ARCHIVE_REASONS = [
  "Tech skills",
  "Domain knowledge",
  "Failed cross-reference check",
  "Not interested",
] as const;

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
  status: "match" | "discrepancy" | "cannot_verify";
  note?: string;
}

export type CredibilitySignal = "clean" | "minor_concerns" | "significant_concerns";

export interface CredibilityAssessment {
  rows: CredibilityRow[];
  trajectoryNote: string;
  industryNote: string;
  resumeDelta?: string;
  overallSignal: CredibilitySignal;
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
   * 2026-07-15 (supabase-migration-archive-reason.sql).
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
