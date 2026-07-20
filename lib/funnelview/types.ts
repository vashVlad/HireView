import type { CandidateStatus, TrackerStage } from "@/lib/types";

/** One candidate mapped into the funnel shape — the extraction seam for a future standalone export. */
export interface FunnelCandidate {
  screeningId: number;
  candidateName: string;
  projectId: number | null;
  projectName: string;
  recruiterId: string | null;
  recruiterEmail: string | null;
  /**
   * "outbound" = LinkedIn-sourced (linkedin_mode), "agency" = came in via an
   * agency (agency_name set), "inbound" = ordinary applicant, the default.
   * Kept as this inbound/outbound/agency naming rather than switching to
   * lib/sourceType.ts's applicant/linkedin/agency strings, to minimize churn
   * across this file's many existing `c.source === "outbound"` call sites —
   * same three-way classification underneath (see getSourceType()). Agency
   * added 2026-07-20, Vlad's ask.
   */
  source: "inbound" | "outbound" | "agency";
  /** Set only when source === "agency". */
  agencyName?: string | null;
  score: number;
  /** True if this score cleared the candidate's own project's score_threshold (defaults to 45 if the project has none set, or no project at all) — independent of current status, so a candidate manually archived later for an unrelated reason still counts as having passed. */
  passedThreshold: boolean;
  status: CandidateStatus;
  previousStatus: CandidateStatus | null;
  trackerStage: TrackerStage | null;
  previousTrackerStage: TrackerStage | null;
  /** Furthest tracker stage reached, even if since rejected — falls back to trackerStage, then previousTrackerStage if the current stage is Reject. */
  furthestStage: TrackerStage | null;
  /** True if either Feature 1.1 (same-project duplicate) or 1.4 (cross-project history alert) has flagged this candidate. */
  hasFraudFlag: boolean;
  createdAt: string;
}

export interface FunnelStageCount {
  key: string;
  label: string;
  count: number;
  /** Percentage of the immediately preceding stage's count. Null for the first stage. */
  conversionFromPrevious: number | null;
}

export interface FunnelSourceSplit {
  inbound: number;
  outbound: number;
  agency: number;
}

/** Same funnel shape as FunnelData's top-level stages, scoped to one project instead of blended across all of them. */
export interface FunnelProjectBreakdown {
  projectId: number;
  projectName: string;
  totalScreened: number;
  stages: FunnelStageCount[];
  archivedOrRejected: number;
}

export interface FunnelData {
  totalScreened: number;
  stages: FunnelStageCount[];
  sourceSplit: FunnelSourceSplit;
  archivedOrRejected: number;
  candidates: FunnelCandidate[];
  /** Per-project breakdown of the same funnel, sorted by totalScreened descending. Candidates with no assigned project are excluded (already reflected in the blended totals above). */
  byProject: FunnelProjectBreakdown[];
}
