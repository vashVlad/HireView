import { getSupabaseClient } from "@/lib/supabase";
import { getRecruiterEmailMap } from "@/lib/recruiters";
import type { CandidateStatus, TrackerStage } from "@/lib/types";
import type { FunnelCandidate, FunnelData, FunnelProjectBreakdown, FunnelStageCount } from "./types";
import { TRACKER_ORDER, candidateMatchesStageKey, stageKeyFor } from "./stageMatch";

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

/**
 * Current company/title/total-experience-summary/linkedin-url, 2026-08-04
 * (Vlad's ask) — deliberately SEPARATE, best-effort queries from the main
 * screenings select above, NOT folded into it. These columns require
 * supabase-migration-current-role.sql; per the pattern documented in
 * memory/decisions-log.md ("this project has hit the same failure mode
 * twice before... wiring a new, not-yet-migrated column into an existing
 * query can make the WHOLE query fail once Postgres rejects the unknown
 * column"), each column is fetched independently below (see
 * fetchCurrentRoleColumn), not bundled into one query.
 *
 * REAL INCIDENT, 2026-08-06: this was originally one bundled query for all
 * three of current_company/current_title/total_experience_summary sharing a
 * single try/catch. total_experience_summary's migration hadn't run yet,
 * which failed that ENTIRE query — wiping out current_company/current_title
 * too, even though those two columns existed and were already populated for
 * 14 real candidates. Vlad reported this as "the columns went gone." Root
 * cause confirmed directly against the live DB (not guessed): 14 non-null
 * current_company/current_title rows existed, total_experience_summary
 * didn't exist as a column at all, and the bundled select errored outright.
 * Splitting into independent per-column queries (below) means any single
 * missing/not-yet-migrated column can only ever null out itself.
 *
 * total_experience_summary is its own short, dedicated field (NOT extracted
 * from career_trajectory) — see lib/generateTrajectory.ts's comment: Vlad
 * asked for this to be much shorter than the trajectory narrative's own
 * closing paragraph, which stays untouched for its existing on-screen uses.
 */
interface ScreeningCurrentRoleRow {
  currentCompany: string | null;
  currentTitle: string | null;
  totalExperienceSummary: string | null;
  linkedinUrl: string | null;
}

/**
 * Fetches one current-role column for every screening, isolated from every
 * other column in this row shape — see ScreeningCurrentRoleRow's comment
 * above for why. Failure (column doesn't exist yet) degrades to an empty
 * map for just this one field, never touching the others.
 */
async function fetchCurrentRoleColumn(
  supabase: ReturnType<typeof getSupabaseClient>,
  column: "current_company" | "current_title" | "total_experience_summary" | "linkedin_url"
): Promise<Map<number, string | null>> {
  try {
    const { data, error } = await supabase
      .from("screenings")
      .select(`id, ${column}`)
      .returns<Record<"id" | typeof column, number | string | null>[]>();
    if (error) throw error;
    return new Map((data ?? []).map((r) => [r.id as number, r[column] as string | null]));
  } catch (err) {
    console.error(`FunnelView: ${column} unavailable (migration likely not run yet) — degrading to nulls for this field only:`, err);
    return new Map();
  }
}

interface TrackerFunnelRow {
  screening_id: number;
  stage: TrackerStage | null;
  previous_stage: TrackerStage | null;
}

function furthestStage(stage: TrackerStage | null, previousStage: TrackerStage | null): TrackerStage | null {
  // Reject is a terminal branch, not a progression step — for "how far did they get"
  // purposes, a rejected candidate's high-water mark is whatever stage they were in
  // immediately before the reject move.
  if (stage === "Reject") return previousStage && previousStage !== "Reject" ? previousStage : null;
  return stage;
}

// "Reached out" / cumulative tracker-stage predicates now live in
// ./stageMatch.ts (candidateMatchesStageKey) — split out 2026-08-04 so
// app/funnelview/page.tsx's row-click drill-down can reuse the exact same
// logic instead of a hand-duplicated copy that could drift out of sync.
// See that file's own comment for the full "why."

/**
 * Raw (label/conversion-free) stage counts for one candidate set — pulled out
 * of computeStages 2026-07-27 so the exact same predicates can be re-run
 * against a source-filtered subset (bySource below) without risking the two
 * ever drifting apart from hand-duplicated filter logic.
 */
function computeRawStageCounts(totalScreened: number, candidates: FunnelCandidate[]): { key: string; label: string; count: number }[] {
  // NOT candidates.length — every screened resume gets a `screenings` row
  // regardless of score (2026-07-15 auto-archive decision), so `candidates`
  // here is the full screened set, same as totalScreened. "Passed Threshold"
  // has to actually filter on the passedThreshold flag computed per-candidate
  // below, or this stage is just a second copy of Total Screened. Fixed
  // 2026-07-16 — see session-log follow-on #38.
  const passedThreshold = candidates.filter((c) => candidateMatchesStageKey(c, "passed_threshold")).length;

  const reachedOut = candidates.filter((c) => candidateMatchesStageKey(c, "reached_out")).length;

  // Cumulative funnel: "reached at least this tracker stage" — a candidate at L2
  // counts toward TA, L1, and L2. Reject doesn't advance the count itself; its
  // furthestStage (computed above) already credits the last real stage reached.
  const trackerCounts = TRACKER_ORDER.map((stage) => {
    const key = stageKeyFor(stage);
    const count = candidates.filter((c) => candidateMatchesStageKey(c, key)).length;
    return { stage, count };
  });

  return [
    { key: "screened", label: "Total Screened", count: totalScreened },
    { key: "passed_threshold", label: "Passed Threshold", count: passedThreshold },
    { key: "reached_out", label: "Reached Out", count: reachedOut },
    ...trackerCounts.map(({ stage, count }) => ({ key: stageKeyFor(stage), label: stage, count })),
  ];
}

/**
 * Builds the funnel stage bars (Total Screened → ... → Offer) plus the
 * archived/rejected count for one slice of candidates — the org-wide
 * blended view and each per-project breakdown all go through this same
 * function, so the two can never silently drift apart in how they count.
 */
function computeStages(totalScreened: number, candidates: FunnelCandidate[]): { stages: FunnelStageCount[]; archivedOrRejected: number } {
  const archivedOrRejected = candidates.filter(
    (c) => c.status === "archived" || c.trackerStage === "Reject"
  ).length;

  const rawStages = computeRawStageCounts(totalScreened, candidates);

  // Per-source breakdown, added 2026-07-27 (Vlad's ask to fold the
  // Sourced/Applied/Agency split into the main funnel bars instead of a
  // separate section) — re-runs the exact same predicates (via
  // computeRawStageCounts) against each source's own subset, so a stage's
  // three segments always sum to exactly that stage's own `count`. Every
  // screened resume has exactly one source, so subset.length is a safe stand-
  // in for "totalScreened, filtered to this source" — same reasoning as the
  // totalScreened === candidates.length equivalence noted above.
  const inboundCandidates = candidates.filter((c) => c.source === "inbound");
  const outboundCandidates = candidates.filter((c) => c.source === "outbound");
  const agencyCandidates = candidates.filter((c) => c.source === "agency");
  const rawInbound = computeRawStageCounts(inboundCandidates.length, inboundCandidates);
  const rawOutbound = computeRawStageCounts(outboundCandidates.length, outboundCandidates);
  const rawAgency = computeRawStageCounts(agencyCandidates.length, agencyCandidates);

  const stages: FunnelStageCount[] = rawStages.map((s, i) => {
    const prev = i > 0 ? rawStages[i - 1].count : null;
    return {
      key: s.key,
      label: s.label,
      count: s.count,
      conversionFromPrevious: prev != null && prev > 0 ? Math.round((s.count / prev) * 100) : null,
      bySource: {
        inbound: rawInbound[i].count,
        outbound: rawOutbound[i].count,
        agency: rawAgency[i].count,
      },
    };
  });

  return { stages, archivedOrRejected };
}

/**
 * Admin-only, org-wide funnel — deliberately not team-scoped (matches the existing
 * /analytics precedent: admin sees everything regardless of team, no new role).
 * See memory/Cirot_Enterprise_Plan.md, FUNNELVIEW section.
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

  // Best-effort, separate from the required query above — see
  // ScreeningCurrentRoleRow's comment for why each of these 4 is its own
  // independent, isolated fetch rather than one combined query. A missing
  // column (migration not yet run) just means that ONE field comes back
  // null for everyone, same as any candidate not yet backfilled — every
  // other field, and the rest of FunnelView, is unaffected.
  const [companyById, titleById, experienceById, linkedinById] = await Promise.all([
    fetchCurrentRoleColumn(supabase, "current_company"),
    fetchCurrentRoleColumn(supabase, "current_title"),
    fetchCurrentRoleColumn(supabase, "total_experience_summary"),
    fetchCurrentRoleColumn(supabase, "linkedin_url"),
  ]);
  const currentRoleByScreeningId = new Map<number, ScreeningCurrentRoleRow>();
  for (const s of screeningsRes.data ?? []) {
    currentRoleByScreeningId.set(s.id, {
      currentCompany: companyById.get(s.id) ?? null,
      currentTitle: titleById.get(s.id) ?? null,
      totalExperienceSummary: experienceById.get(s.id) ?? null,
      linkedinUrl: linkedinById.get(s.id) ?? null,
    });
  }

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
    const currentRole = currentRoleByScreeningId.get(s.id);
    return {
      screeningId: s.id,
      candidateName: s.candidate_name,
      projectId: s.project_id,
      projectName: s.project_id != null ? (projectNameById.get(s.project_id) ?? `Project ${s.project_id}`) : "—",
      recruiterId: s.user_id,
      recruiterEmail: s.user_id != null ? (emailByUserId.get(s.user_id) ?? s.user_id) : null,
      currentCompany: currentRole?.currentCompany ?? null,
      currentTitle: currentRole?.currentTitle ?? null,
      totalExperienceSummary: currentRole?.totalExperienceSummary ?? null,
      linkedinUrl: currentRole?.linkedinUrl ?? null,
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
