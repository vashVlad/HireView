export interface CandidateResult {
  fileName: string;
  candidateName: string;
  score: number;
  summary: string;
  strengths: string[];
  concerns: string[];
}

export interface ScreenResumesResponse {
  results: CandidateResult[];
}

export interface ScreenResumesError {
  fileName: string;
  error: string;
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
