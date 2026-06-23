export type Recommendation = "proceed" | "decline";

export type CandidateStatus = "new_applicant" | "recruiter_screen" | "contacted" | "screening";

export const CANDIDATE_STATUSES: CandidateStatus[] = [
  "new_applicant",
  "recruiter_screen",
  "contacted",
  "screening",
];

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  new_applicant: "New Applicant",
  recruiter_screen: "Recruiter Screen",
  contacted: "Contacted",
  screening: "Screening",
};

export interface CandidateResult {
  fileName: string;
  candidateName: string;
  score: number;
  summary: string;
  strengths: string[];
  concerns: string[];
  recommendation: Recommendation;
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
  summary: string;
  strengths: string[];
  concerns: string[];
  recommendation: Recommendation | null;
  status: CandidateStatus;
  jobDescription: string;
  resumeMimeType: string;
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

export interface JDAnalysis {
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  jobTitles: string[];
  jobTitlesBoolean: string;
  seniorityLevels: string[];
  jobFunctions: string[];
  yearsExperience: string;
  yearsInCurrentPosition: string;
  targetCompanies: string[];
  companySize: string[];
  industries: string[];
  keywordsBooleanBroad: string;
  keywordsBooleanTight: string;
  rationale: string;
}
