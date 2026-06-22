import { randomUUID } from "crypto";
import { getSupabaseClient, RESUME_BUCKET } from "./supabase";
import type { CandidateResult, ScreeningRecord } from "./types";

interface ScreeningRow {
  id: number;
  candidate_name: string;
  file_name: string;
  score: number;
  summary: string;
  strengths: string[];
  concerns: string[];
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
    summary: row.summary,
    strengths: row.strengths,
    concerns: row.concerns,
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
}) {
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
    summary: result.summary,
    strengths: result.strengths,
    concerns: result.concerns,
    job_description: jobDescription,
    resume_path: resumePath,
    resume_mime_type: resumeMimeType,
  });
  if (insert.error) throw insert.error;
}

export async function listScreenings(query?: string): Promise<ScreeningRecord[]> {
  const supabase = getSupabaseClient();

  let request = supabase
    .from("screenings")
    .select(
      "id, candidate_name, file_name, score, summary, strengths, concerns, job_description, resume_mime_type, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (query?.trim()) {
    request = request.ilike("candidate_name", `%${query.trim()}%`);
  }

  const { data, error } = await request.returns<ScreeningRow[]>();
  if (error) throw error;

  return (data ?? []).map(rowToRecord);
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
