import { getSupabaseClient } from "./supabase";
import type { JDAnalysis, Project, ProjectStatus, ProjectSummary } from "./types";

interface ProjectRow {
  id: number;
  name: string;
  job_description: string;
  jd_analysis: JDAnalysis | null;
  status: ProjectStatus;
  score_threshold: number;
  team_id: number | null;
  created_at: string;
  updated_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    jobDescription: row.job_description,
    jdAnalysis: row.jd_analysis,
    status: row.status,
    scoreThreshold: row.score_threshold ?? 45,
    ...(row.team_id != null ? { teamId: row.team_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createProject(params: {
  name: string;
  jobDescription: string;
  jdAnalysis?: JDAnalysis;
  userId?: string;
  teamId?: number | null;
}): Promise<Project> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      name: params.name.trim(),
      job_description: params.jobDescription,
      jd_analysis: params.jdAnalysis ?? null,
      user_id: params.userId ?? null,
      team_id: params.teamId ?? null,
    })
    .select()
    .single<ProjectRow>();
  if (error) throw error;
  return rowToProject(data);
}

/**
 * teamIds: undefined = no filter (admin, sees all). Empty array = recruiter
 * with no team membership, short-circuits to [] without hitting the DB
 * (an `.in(col, [])` filter is not a reliable "match nothing" across drivers).
 */
export async function listProjects(teamIds?: number[]): Promise<Project[]> {
  if (teamIds != null && teamIds.length === 0) return [];
  const supabase = getSupabaseClient();
  let query = supabase
    .from("projects")
    .select("id, name, job_description, jd_analysis, status, score_threshold, team_id, created_at, updated_at")
    .order("created_at", { ascending: false });
  if (teamIds != null) query = query.in("team_id", teamIds);
  const { data, error } = await query.returns<ProjectRow[]>();
  if (error) throw error;
  return (data ?? []).map(rowToProject);
}

export async function getProject(id: number): Promise<Project | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, job_description, jd_analysis, status, score_threshold, team_id, created_at, updated_at")
    .eq("id", id)
    .maybeSingle<ProjectRow>();
  if (error) throw error;
  if (!data) return null;
  return rowToProject(data);
}

export async function updateProject(
  id: number,
  fields: {
    name?: string;
    jobDescription?: string;
    jdAnalysis?: JDAnalysis;
    status?: ProjectStatus;
    scoreThreshold?: number;
    /**
     * Move a project to a different team, or unassign it (null). Added
     * 2026-07-15 for the admin drag-and-drop Team/Projects page — previously
     * a project's team was set once at creation (auto-assigned to the
     * creator's primary team) with no way to change it. Admin-only at the
     * API-route level (see app/api/projects/[id]/route.ts) — not enforced
     * here since this is the shared data-layer function.
     */
    teamId?: number | null;
    /**
     * See Project.excludeFromFitSuggestions (lib/types.ts). Requires
     * supabase-migration-exclude-from-fit-suggestions.sql — NOT YET
     * CONFIRMED RUN as of this comment. Written conditionally same as every
     * other deferred column (e.g. crossRefIsLinkedIn on updateScreening) —
     * the write itself only fails if the column is genuinely missing.
     */
    excludeFromFitSuggestions?: boolean;
  }
): Promise<void> {
  const supabase = getSupabaseClient();
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.name !== undefined) payload.name = fields.name.trim();
  if (fields.jobDescription !== undefined) payload.job_description = fields.jobDescription;
  if (fields.jdAnalysis !== undefined) payload.jd_analysis = fields.jdAnalysis;
  if (fields.status !== undefined) payload.status = fields.status;
  if (fields.scoreThreshold !== undefined) payload.score_threshold = Math.max(0, Math.min(100, fields.scoreThreshold));
  if (fields.teamId !== undefined) payload.team_id = fields.teamId;
  if (fields.excludeFromFitSuggestions !== undefined) payload.exclude_from_fit_suggestions = fields.excludeFromFitSuggestions;
  const { error } = await supabase.from("projects").update(payload).eq("id", id);
  if (error) throw error;
}

/**
 * Isolated, single-purpose read for Project.excludeFromFitSuggestions —
 * kept OUT of listProjects()/getProject()'s shared select per the Migration
 * Sequencing rule (see supabase-migration-exclude-from-fit-suggestions.sql's
 * header). Fails closed to an empty set (nothing excluded) on any error,
 * including the column not existing yet, so a missing migration can only
 * ever make Cross-Project Fit Suggestion behave as if no project opted out
 * — it can never break listing/reading projects elsewhere in the app.
 */
export async function getFitExclusionMap(projectIds: number[]): Promise<Set<number>> {
  if (projectIds.length === 0) return new Set();
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("projects")
      .select("id, exclude_from_fit_suggestions")
      .in("id", projectIds)
      .returns<{ id: number; exclude_from_fit_suggestions: boolean | null }[]>();
    if (error) throw error;
    return new Set((data ?? []).filter((r) => r.exclude_from_fit_suggestions).map((r) => r.id));
  } catch (err) {
    console.error("getFitExclusionMap failed (non-fatal — treated as nothing excluded):", err);
    return new Set();
  }
}

/** Single-id convenience wrapper around getFitExclusionMap, for Settings' own read. */
export async function getProjectFitExclusion(id: number): Promise<boolean> {
  const set = await getFitExclusionMap([id]);
  return set.has(id);
}

export async function deleteProject(id: number): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}

export async function getProjectSummaries(teamIds?: number[]): Promise<ProjectSummary[]> {
  const projects = await listProjects(teamIds);
  if (projects.length === 0) return [];

  const supabase = getSupabaseClient();
  const ids = projects.map((p) => p.id);

  const [screeningRes, inTrackerRes] = await Promise.all([
    supabase
      .from("screenings")
      .select("project_id")
      .in("project_id", ids)
      .returns<{ project_id: number }[]>(),
    // "screening" status = actively in the Tracker (TA/L1/L2/In-Person/Offer
    // arc) — was "interview" before that status was removed 2026-07-15.
    supabase
      .from("screenings")
      .select("project_id")
      .in("project_id", ids)
      .eq("status", "screening")
      .returns<{ project_id: number }[]>(),
  ]);

  const screeningCounts = new Map<number, number>();
  for (const row of screeningRes.data ?? []) {
    if (row.project_id != null)
      screeningCounts.set(row.project_id, (screeningCounts.get(row.project_id) ?? 0) + 1);
  }

  const inTrackerCounts = new Map<number, number>();
  for (const row of inTrackerRes.data ?? []) {
    if (row.project_id != null)
      inTrackerCounts.set(row.project_id, (inTrackerCounts.get(row.project_id) ?? 0) + 1);
  }

  const teamIdsPresent = [...new Set(projects.map((p) => p.teamId).filter((t): t is number => t != null))];
  let teamNameById = new Map<number, string>();
  if (teamIdsPresent.length > 0) {
    const { data: teams } = await supabase.from("teams").select("id, name").in("id", teamIdsPresent).returns<{ id: number; name: string }[]>();
    teamNameById = new Map((teams ?? []).map((t) => [t.id, t.name]));
  }

  return projects.map((p) => ({
    ...p,
    screeningCount: screeningCounts.get(p.id) ?? 0,
    inTrackerCount: inTrackerCounts.get(p.id) ?? 0,
    ...(p.teamId != null && teamNameById.has(p.teamId) ? { teamName: teamNameById.get(p.teamId) } : {}),
  }));
}
