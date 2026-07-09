import type { CandidateStatus, TrackerStage } from "@/lib/types";

/** One candidate mapped into the funnel shape — the extraction seam for a future standalone export. */
export interface FunnelCandidate {
  screeningId: number;
  candidateName: string;
  projectId: number | null;
  projectName: string;
  recruiterId: string | null;
  recruiterEmail: string | null;
  source: "inbound" | "outbound";
  status: CandidateStatus;
  previousStatus: CandidateStatus | null;
  trackerStage: TrackerStage | null;
  previousTrackerStage: TrackerStage | null;
  /** Furthest tracker stage reached, even if since rejected — falls back to trackerStage, then previousTrackerStage if the current stage is Reject. */
  furthestStage: TrackerStage | null;
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
}

export interface FunnelData {
  totalScreened: number;
  stages: FunnelStageCount[];
  sourceSplit: FunnelSourceSplit;
  archivedOrRejected: number;
  candidates: FunnelCandidate[];
}
