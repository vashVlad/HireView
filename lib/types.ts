export type Recommendation = "proceed" | "decline";

export type CandidateStatus = "new_applicant" | "recruiter_screen" | "contacted" | "screening" | "interview" | "archived";

export const CANDIDATE_STATUSES: CandidateStatus[] = [
  "new_applicant",
  "recruiter_screen",
  "contacted",
  "screening",
  "interview",
  "archived",
];

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  new_applicant: "New Applicant",
  recruiter_screen: "Recruiter Screen",
  contacted: "Contacted",
  screening: "Screening",
  interview: "Interview",
  archived: "Archived",
};

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
  nextStep: string;
  stepsCompleted: string;
  comments: string;
  immigration: string;
  onHold: boolean;
  onHoldReason: string;
  orderIndex: number;
  createdAt: string;
}

// ── Credibility assessment ───────────────────────────────────────────────────

export interface CredibilityRow {
  field: string;       // e.g. "Current title", "Google (2019–2022)"
  resume: string;      // What the resume says
  linkedIn: string;    // What LinkedIn says, or "Not shown on LinkedIn"
  status: "match" | "discrepancy" | "cannot_verify";
  note?: string;       // Extra context for discrepancies
}

export type CredibilitySignal = "clean" | "minor_concerns" | "significant_concerns";

export interface CredibilityAssessment {
  rows: CredibilityRow[];
  trajectoryNote: string;
  industryNote: string;
  resumeDelta?: string;  // Only present when a second resume was uploaded
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
  jobDescription: string;
  resumeMimeType: string;
  flagged: boolean;
  flagNote?: string;
  notes?: string;
  credibility?: CredibilityAssessment;
  createdAt: string;
}

// ── Resume comparison ────────────────────────────────────────────────────────

export type ComparisonVerdict = "consistent" | "minor_tweaks" | "significant_reframe" | "suspicious";

export interface ResumeChange {
  field: string;
  inResumeA: string;
  inResumeB: string;
  severity: "minor" | "notable" | "red_flag";
}

export interface ResumeComparisonResult {
  verdict: ComparisonVerdict;
  summary: string;
  changes: ResumeChange[];
  redFlags: string[];
}

export interface ComparisonRecord {
  id: number;
  screeningId: number;
  newResumeFilename: string;
  newResumeRole: string | null;
  verdict: ComparisonVerdict;
  summary: string;
  changes: ResumeChange[];
  redFlags: string[];
  createdAt: string;
}

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
}
