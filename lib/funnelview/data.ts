import { getSupabaseClient } from "@/lib/supabase";
import { getRecruiterEmailMap } from "@/lib/recruiters";
import type { CandidateStatus, TrackerStage } from "@/lib/types";
import type { FunnelCandidate, FunnelData, FunnelStageCount } from "./types";

// Isolated data layer — deliberately does not import lib/screenings.ts or reuse
// SCREENING_COLUMNS. FunnelView needs its own column set (user_id, linkedin_mode,
// previous_status) that the shared screening list queries don't select, and this
// module should have zero entanglement with the core screening/scoring path.
// See memory/decisions-log.md, 2026-07-08 entry, for why this is a separate module.

interface ScreeningFunnelRow {
  id: number;
  candidate_name: string;
  project_id: number | null;
  user_id: string | null;
  status: CandidateStatus;
  previous_status: CandidateStatus | null;
  linkedin_mode: boolean;
  score: number;
  duplicate_flag: boolean | null;
  history_alert_type: string | null;
  created_at: string;
}

interface TrackerFunnelRow {
  screening_id: number;
  stage: TrackerStage | null;
  previous_stage: TrackerStage | null;
}

const TRACKER_ORDER: TrackerStage[] = ["TA", "L1", "L2", "In-Person", "Offer"];

function furthestStage(stage: TrackerStage | null, previousStage: TrackerStage | null): TrackerStage | null {
  // Reject is a terminal branch, not a progression step — for "how far did they get"
  // purposes, a rejected candidate's high-water mark is whatever stage they were in
  // immediately before the reject move.
  if (stage === "Reject") return previousStage && previousStage !== "Reject" ? previousStage : null;
  return stage;
}

/**
 * Admin-only, org-wide funnel — deliberately not team-scoped (matches the existing
 * /analytics precedent: admin sees everything regardless of team, no new role).
 * See memory/HireView_Enterprise_Plan.md, FUNNELVIEW section.
 */
export async function getFunnelData(): Promise<FunnelData> {
  const supabase = getSupabaseClient();

  const [batchesRes, screeningsRes, trackerRes, projectsRes, emailByUserId] = await Promise.all([
    supabase.from("screening_batches").select("total_count"),
    supabase
      .from("screenings")
      .select(
        "id, candidate_name, project_id, user_id, status, previous_status, linkedin_mode, score, duplicate_flag, history_alert_type, created_at"
      )
      .returns<ScreeningFunnelRow[]>(),
    supabase.from("tracker").select("screening_id, stage, previous_stage").returns<TrackerFunnelRow[]>(),
    supabase.from("projects").select("id, name").returns<{ id: number; name: string }[]>(),
    getRecruiterEmailMap(),
  ]);

  if (screeningsRes.error) throw screeningsRes.error;
  if (trackerRes.error) throw trackerRes.error;

  const batches = (batchesRes.data ?? []) as { total_count: number }[];
  const totalScreened = batches.reduce((sum, b) => sum + b.total_count, 0);

  const screenings = screeningsRes.data ?? [];
  const trackerByScreeningId = new Map((trackerRes.data ?? []).map((t) => [t.screening_id, t]));
  const projectNameById = new Map((projectsRes.data ?? []).map((p) => [p.id, p.name]));

  const candidates: FunnelCandidate[] = screenings.map((s) => {
    const tracker = trackerByScreeningId.get(s.id);
    const stage = tracker?.stage ?? null;
    const previousStage = tracker?.previous_stage ?? null;
    return {
      screeningId: s.id,
      candidateName: s.candidate_name,
      projectId: s.project_id,
      projectName: s.project_id != null ? (projectNameById.get(s.project_id) ?? `Project ${s.project_id}`) : "—",
      recruiterId: s.user_id,
      recruiterEmail: s.user_id != null ? (emailByUserId.get(s.user_id) ?? s.user_id) : null,
      source: s.linkedin_mode ? "outbound" : "inbound",
      score: s.score,
      hasFraudFlag: Boolean(s.duplicate_flag) || s.history_alert_type != null,
      status: s.status,
      previousStatus: s.previous_status,
      trackerStage: stage,
      previousTrackerStage: previousStage,
      furthestStage: furthestStage(stage, previousStage),
      createdAt: s.created_at,
    };
  });

  const passedThreshold = candidates.length;
  const reachedOut = candidates.filter((c) => c.status !== "new_applicant").length;
  const archivedOrRejected = candidates.filter(
    (c) => c.status === "archived" || c.trackerStage === "Reject"
  ).length;

  // Cumulative funnel: "reached at least this tracker stage" — a candidate at L2
  // counts toward TA, L1, and L2. Reject doesn't advance the count itself; its
  // furthestStage (computed above) already credits the last real stage reached.
  const stageIndex = new Map(TRACKER_ORDER.map((s, i) => [s, i]));
  const trackerCounts = TRACKER_ORDER.map((stage) => {
    const idx = stageIndex.get(stage)!;
    const count = candidates.filter((c) => {
      const reached = c.furthestStage;
      if (!reached) return false;
      const reachedIdx = stageIndex.get(reached);
      return reachedIdx != null && reachedIdx >= idx;
    }).length;
    return { stage, count };
  });

  const rawStages: { key: string; label: string; count: number }[] = [
    { key: "screened", label: "Total Screened", count: totalScreened },
    { key: "passed_threshold", label: "Passed Threshold", count: passedThreshold },
    { key: "reached_out", label: "Reached Out", count: reachedOut },
    ...trackerCounts.map(({ stage, count }) => ({ key: stage.toLowerCase().replace(/[^a-z0-9]/g, "_"), label: stage, count })),
  ];

  const stages: FunnelStageCount[] = rawStages.map((s, i) => {
    const prev = i > 0 ? rawStages[i - 1].count : null;
    return {
      key: s.key,
      label: s.label,
      count: s.count,
      conversionFromPrevious: prev != null && prev > 0 ? Math.round((s.count / prev) * 100) : null,
    };
  });

  const sourceSplit = {
    inbound: candidates.filter((c) => c.source === "inbound").length,
    outbound: candidates.filter((c) => c.source === "outbound").length,
  };

  return { totalScreened, stages, sourceSplit, archivedOrRejected, candidates };
}
