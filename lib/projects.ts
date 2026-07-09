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
    .select("id, name, job_description, jd_analysis, status, score_threshold, created_at, updated_at")
    .eq("id", id)
    .maybeSingle<ProjectRow>();
  if (error) throw error;
  if (!data) return null;
  return rowToProject(data);
}

export async function updateProject(
  id: number,
  fields: { name?: string; jobDescription?: string; jdAnalysis?: JDAnalysis; status?: ProjectStatus; scoreThreshold?: number }
): Promise<void> {
  const supabase = getSupabaseClient();
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.name !== undefined) payload.name = fields.name.trim();
  if (fields.jobDescription !== undefined) payload.job_description = fields.jobDescription;
  if (fields.jdAnalysis !== undefined) payload.jd_analysis = fields.jdAnalysis;
  if (fields.status !== undefined) payload.status = fields.status;
  if (fields.scoreThreshold !== undefined) payload.score_threshold = Math.max(0, Math.min(100, fields.scoreThreshold));
  const { error } = await supabase.from("projects").update(payload).eq("id", id);
  if (error) throw error;
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

  const [screeningRes, interviewRes] = await Promise.all([
    supabase
      .from("screenings")
      .select("project_id")
      .in("project_id", ids)
      .returns<{ project_id: number }[]>(),
    supabase
      .from("screenings")
      .select("project_id")
      .in("project_id", ids)
      .eq("status", "interview")
      .returns<{ project_id: number }[]>(),
  ]);

  const screeningCounts = new Map<number, number>();
  for (const row of screeningRes.data ?? []) {
    if (row.project_id != null)
      screeningCounts.set(row.project_id, (screeningCounts.get(row.project_id) ?? 0) + 1);
  }

  const interviewCounts = new Map<number, number>();
  for (const row of interviewRes.data ?? []) {
    if (row.project_id != null)
      interviewCounts.set(row.project_id, (interviewCounts.get(row.project_id) ?? 0) + 1);
  }

  return projects.map((p) => ({
    ...p,
    screeningCount: screeningCounts.get(p.id) ?? 0,
    interviewCount: interviewCounts.get(p.id) ?? 0,
  }));
}
