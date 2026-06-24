import { randomUUID } from "crypto";
import { getSupabaseClient, RESUME_BUCKET } from "./supabase";
import type { CandidateResult, CandidateStatus, Recommendation, ScreeningRecord } from "./types";

interface ScreeningRow {
  id: number;
  candidate_name: string;
  file_name: string;
  score: number;
  must_have_score: number | null;
  nice_to_have_score: number | null;
  summary: string;
  strengths: string[];
  concerns: string[];
  recommendation: Recommendation | null;
  status: CandidateStatus;
  status_updated_at: string | null;
  job_description: string;
  resume_path: string;
  resume_mime_type: string;
  created_at: string;
}

function rowToRecord(row: ScreeningRow): ScreeningRecord {
  return {
    id: row.id,
    candidateName: row.candidate_name,
    fileName: row.file_name,
    score: row.score,
    ...(row.must_have_score != null && { mustHaveScore: row.must_have_score }),
    ...(row.nice_to_have_score != null && { niceToHaveScore: row.nice_to_have_score }),
    summary: row.summary,
    strengths: row.strengths,
    concerns: row.concerns,
    recommendation: row.recommendation,
    status: row.status,
    ...(row.status_updated_at != null && { statusUpdatedAt: row.status_updated_at }),
    jobDescription: row.job_description,
    resumeMimeType: row.resume_mime_type,
    createdAt: row.created_at,
  };
}

export async function saveScreening(params: {
  result: CandidateResult;
  jobDescription: string;
  resumeFile: Buffer;
  resumeMimeType: string;
}): Promise<{ id: number }> {
  const { result, jobDescription, resumeFile, resumeMimeType } = params;
  const supabase = getSupabaseClient();

  const resumePath = `${randomUUID()}/${result.fileName}`;
  const upload = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(resumePath, resumeFile, { contentType: resumeMimeType });
  if (upload.error) throw upload.error;

  const insert = await supabase.from("screenings").insert({
    candidate_name: result.candidateName,
    file_name: result.fileName,
    score: result.score,
    must_have_score: result.mustHaveScore ?? null,
    nice_to_have_score: result.niceToHaveScore ?? null,
    summary: result.summary,
    strengths: result.strengths,
    concerns: result.concerns,
    recommendation: result.recommendation,
    job_description: jobDescription,
    resume_path: resumePath,
    resume_mime_type: resumeMimeType,
  }).select("id").single<{ id: number }>();
  if (insert.error) throw insert.error;

  return { id: insert.data.id };
}

export async function listScreenings(
  query?: string,
  statuses?: CandidateStatus[]
): Promise<ScreeningRecord[]> {
  const supabase = getSupabaseClient();

  let request = supabase
    .from("screenings")
    .select(
      "id, candidate_name, file_name, score, must_have_score, nice_to_have_score, summary, strengths, concerns, recommendation, status, status_updated_at, job_description, resume_mime_type, created_at"
    )
    .order(statuses && statuses.length > 0 ? "score" : "created_at", { ascending: false })
    .limit(200);

  if (query?.trim()) {
    request = request.ilike("candidate_name", `%${query.trim()}%`);
  }

  if (statuses && statuses.length > 0) {
    request = request.in("status", statuses);
  }

  const { data, error } = await request.returns<ScreeningRow[]>();
  if (error) throw error;

  return (data ?? []).map(rowToRecord);
}

export async function getStatusCounts(): Promise<Record<CandidateStatus, number>> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("screenings")
    .select("status")
    .returns<{ status: CandidateStatus }[]>();
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts as Record<CandidateStatus, number>;
}

export async function updateScreeningStatus(
  id: number,
  status: CandidateStatus
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from("screenings")
    .update({ status, status_updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function getScreeningResume(
  id: number
): Promise<{ data: Buffer; mimeType: string; fileName: string } | null> {
  const supabase = getSupabaseClient();

  const { data: row, error } = await supabase
    .from("screenings")
    .select("resume_path, resume_mime_type, file_name")
    .eq("id", id)
    .maybeSingle<Pick<ScreeningRow, "resume_path" | "resume_mime_type" | "file_name">>();
  if (error) throw error;
  if (!row) return null;

  const download = await supabase.storage.from(RESUME_BUCKET).download(row.resume_path);
  if (download.error) throw download.error;

  const data = Buffer.from(await download.data.arrayBuffer());
  return { data, mimeType: row.resume_mime_type, fileName: row.file_name };
}

export async function deleteScreening(id: number): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: row } = await supabase
    .from("screenings")
    .select("resume_path")
    .eq("id", id)
    .maybeSingle<Pick<ScreeningRow, "resume_path">>();

  if (row) {
    // Best-effort: a missing/already-gone file shouldn't block deleting the record.
    await supabase.storage.from(RESUME_BUCKET).remove([row.resume_path]);
  }

  const { error } = await supabase.from("screenings").delete().eq("id", id);
  if (error) throw error;
}
