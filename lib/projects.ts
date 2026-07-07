import { getSupabaseClient } from "./supabase";
import type { JDAnalysis, Project, ProjectStatus, ProjectSummary } from "./types";

interface ProjectRow {
  id: number;
  name: string;
  job_description: string;
  jd_analysis: JDAnalysis | null;
  status: ProjectStatus;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createProject(params: {
  name: string;
  jobDescription: string;
  jdAnalysis?: JDAnalysis;
}): Promise<Project> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      name: params.name.trim(),
      job_description: params.jobDescription,
      jd_analysis: params.jdAnalysis ?? null,
    })
    .select()
    .single<ProjectRow>();
  if (error) throw error;
  return rowToProject(data);
}

export async function listProjects(): Promise<Project[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, job_description, jd_analysis, status, created_at, updated_at")
    .order("created_at", { ascending: false })
    .returns<ProjectRow[]>();
  if (error) throw error;
  return (data ?? []).map(rowToProject);
}

export async function getProject(id: number): Promise<Project | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, job_description, jd_analysis, status, created_at, updated_at")
    .eq("id", id)
    .maybeSingle<ProjectRow>();
  if (error) throw error;
  if (!data) return null;
  return rowToProject(data);
}

export async function updateProject(
  id: number,
  fields: { name?: string; jobDescription?: string; jdAnalysis?: JDAnalysis; status?: ProjectStatus }
): Promise<void> {
  const supabase = getSupabaseClient();
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.name !== undefined) payload.name = fields.name.trim();
  if (fields.jobDescription !== undefined) payload.job_description = fields.jobDescription;
  if (fields.jdAnalysis !== undefined) payload.jd_analysis = fields.jdAnalysis;
  if (fields.status !== undefined) payload.status = fields.status;
  const { error } = await supabase.from("projects").update(payload).eq("id", id);
  if (error) throw error;
}

export async function deleteProject(id: number): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}

export async function getProjectSummaries(): Promise<ProjectSummary[]> {
  const projects = await listProjects();
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
