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
