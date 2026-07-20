import { getSupabaseClient } from "@/lib/supabase";
import { getRecruiterEmailMap } from "@/lib/recruiters";
import type { CandidateStatus, TrackerStage } from "@/lib/types";
import type { FunnelCandidate, FunnelData, FunnelProjectBreakdown, FunnelStageCount } from "./types";

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
  agency_name: string | null;
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
 * Builds the funnel stage bars (Total Screened → ... → Offer) plus the
 * archived/rejected count for one slice of candidates — the org-wide
 * blended view and each per-project breakdown all go through this same
 * function, so the two can never silently drift apart in how they count.
 */
function computeStages(totalScreened: number, candidates: FunnelCandidate[]): { stages: FunnelStageCount[]; archivedOrRejected: number } {
  // NOT candidates.length — every screened resume gets a `screenings` row
  // regardless of score (2026-07-15 auto-archive decision), so `candidates`
  // here is the full screened set, same as totalScreened. "Passed Threshold"
  // has to actually filter on the passedThreshold flag computed per-candidate
  // below, or this stage is just a second copy of Total Screened. Fixed
  // 2026-07-16 — see session-log follow-on #38.
  const passedThreshold = candidates.filter((c) => c.passedThreshold).length;

  // NOT `status !== "new_applicant"` — that treats every archived candidate
  // as "reached out," including ones nobody ever actually contacted:
  // below-threshold candidates are auto-archived straight from creation
  // (previousStatus stays null, no engagement ever happened), and a
  // recruiter can also archive a "new_applicant" directly without moving
  // them through recruiter_screen/contacted/screening first. Vlad flagged
  // this 2026-07-16 after noticing the number looked too high. The
  // previous_status column is trigger-maintained on every status UPDATE
  // (supabase-migration-previous-status.sql) and always holds the status
  // immediately before the current one — so for an archived candidate,
  // checking previousStatus tells us whether they passed through real
  // engagement on their way there. "Reached out" now means: currently in
  // an active engagement status, OR archived after having been in one.
  const ACTIVE_ENGAGEMENT_STATUSES: CandidateStatus[] = ["recruiter_screen", "contacted", "screening"];
  const reachedOut = candidates.filter(
    (c) =>
      ACTIVE_ENGAGEMENT_STATUSES.includes(c.status) ||
      (c.status === "archived" && c.previousStatus != null && ACTIVE_ENGAGEMENT_STATUSES.includes(c.previousStatus))
  ).length;
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

  return { stages, archivedOrRejected };
}

/**
 * Admin-only, org-wide funnel — deliberately not team-scoped (matches the existing
 * /analytics precedent: admin sees everything regardless of team, no new role).
 * See memory/HireView_Enterprise_Plan.md, FUNNELVIEW section.
 */
export async function getFunnelData(): Promise<FunnelData> {
  const supabase = getSupabaseClient();

  // Deliberately no screening_batches query here — that table is an
  // immutable per-upload-batch log (written once, never updated on later
  // deletion), so sourcing totalScreened from it meant deleting a candidate
  // could never move the number. Switched to a live count off `screenings`
  // itself (see session-log follow-on #37). This branch was re-merged from a
  // pre-#37 base and briefly regressed this — re-fixed 2026-07-17.
  const [screeningsRes, trackerRes, projectsRes, emailByUserId] = await Promise.all([
    supabase
      .from("screenings")
      .select(
        "id, candidate_name, project_id, user_id, status, previous_status, linkedin_mode, agency_name, score, duplicate_flag, history_alert_type, created_at"
      )
      .returns<ScreeningFunnelRow[]>(),
    supabase.from("tracker").select("screening_id, stage, previous_stage").returns<TrackerFunnelRow[]>(),
    // score_threshold added 2026-07-16 so "Passed Threshold" can be computed
    // per-candidate against their own project's real threshold (defaults to
    // 45, matching lib/projects.ts) instead of every screened row counting
    // as "passed" now that below-threshold candidates are saved too.
    supabase.from("projects").select("id, name, score_threshold").returns<{ id: number; name: string; score_threshold: number | null }[]>(),
    getRecruiterEmailMap(),
  ]);

  if (screeningsRes.error) throw screeningsRes.error;
  if (trackerRes.error) throw trackerRes.error;

  const screenings = screeningsRes.data ?? [];
  const totalScreened = screenings.length;
  const trackerByScreeningId = new Map((trackerRes.data ?? []).map((t) => [t.screening_id, t]));
  const projectNameById = new Map((projectsRes.data ?? []).map((p) => [p.id, p.name]));
  const scoreThresholdByProjectId = new Map((projectsRes.data ?? []).map((p) => [p.id, p.score_threshold ?? 45]));

  const candidates: FunnelCandidate[] = screenings.map((s) => {
    const tracker = trackerByScreeningId.get(s.id);
    const stage = tracker?.stage ?? null;
    const previousStage = tracker?.previous_stage ?? null;
    const threshold = s.project_id != null ? (scoreThresholdByProjectId.get(s.project_id) ?? 45) : 45;
    return {
      screeningId: s.id,
      candidateName: s.candidate_name,
      projectId: s.project_id,
      projectName: s.project_id != null ? (projectNameById.get(s.project_id) ?? `Project ${s.project_id}`) : "—",
      recruiterId: s.user_id,
      recruiterEmail: s.user_id != null ? (emailByUserId.get(s.user_id) ?? s.user_id) : null,
      source: s.linkedin_mode ? "outbound" : s.agency_name ? "agency" : "inbound",
      ...(s.agency_name ? { agencyName: s.agency_name } : {}),
      score: s.score,
      passedThreshold: s.score >= threshold,
      hasFraudFlag: Boolean(s.duplicate_flag) || s.history_alert_type != null,
      status: s.status,
      previousStatus: s.previous_status,
      trackerStage: stage,
      previousTrackerStage: previousStage,
      furthestStage: furthestStage(stage, previousStage),
      createdAt: s.created_at,
    };
  });

  const { stages, archivedOrRejected } = computeStages(totalScreened, candidates);

  const sourceSplit = {
    inbound: candidates.filter((c) => c.source === "inbound").length,
    outbound: candidates.filter((c) => c.source === "outbound").length,
    agency: candidates.filter((c) => c.source === "agency").length,
  };

  // Per-project breakdown — same funnel shape as above, scoped to one project
  // at a time, so a blended org-wide number can't hide one specific role
  // converting badly. Keyed off `screenings` alone (live counts, matching
  // totalScreened above) — a project's totalScreened here is just its
  // candidate row count. Candidates with no assigned project are left out of
  // this list (they're still counted in the blended totals above).
  const candidatesByProject = new Map<number, FunnelCandidate[]>();
  for (const c of candidates) {
    if (c.projectId == null) continue;
    const list = candidatesByProject.get(c.projectId);
    if (list) list.push(c);
    else candidatesByProject.set(c.projectId, [c]);
  }

  const byProject: FunnelProjectBreakdown[] = Array.from(candidatesByProject.entries()).map(([projectId, projectCandidates]) => {
    const projectTotalScreened = projectCandidates.length;
    const { stages: projectStages, archivedOrRejected: projectArchivedOrRejected } = computeStages(projectTotalScreened, projectCandidates);
    return {
      projectId,
      projectName: projectNameById.get(projectId) ?? `Project ${projectId}`,
      totalScreened: projectTotalScreened,
      stages: projectStages,
      archivedOrRejected: projectArchivedOrRejected,
    };
  }).sort((a, b) => b.totalScreened - a.totalScreened);

  return { totalScreened, stages, sourceSplit, archivedOrRejected, candidates, byProject };
}
