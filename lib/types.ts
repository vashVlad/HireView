export type Recommendation = "proceed" | "decline";

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
  jobDescription: string;
  resumeMimeType: string;
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
