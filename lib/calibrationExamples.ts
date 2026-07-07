import { randomUUID } from "crypto";
import { getSupabaseClient, RESUME_BUCKET } from "./supabase";
import type { CalibrationExample, CalibrationLabel } from "./types";

interface CalibrationExampleRow {
  id: number;
  label: CalibrationLabel;
  note: string | null;
  file_name: string;
  resume_path: string;
  resume_mime_type: string;
  extracted_text: string;
  project_id: number | null;
  created_at: string;
}

function rowToExample(row: CalibrationExampleRow): CalibrationExample {
  return {
    id: row.id,
    label: row.label,
    note: row.note,
    fileName: row.file_name,
    resumeMimeType: row.resume_mime_type,
    extractedText: row.extracted_text,
    createdAt: row.created_at,
  };
}

export async function saveCalibrationExample(params: {
  label: CalibrationLabel;
  note: string | null;
  fileName: string;
  extractedText: string;
  resumeFile: Buffer;
  resumeMimeType: string;
  projectId?: number;
  userId?: string;
}): Promise<CalibrationExample> {
  const { label, note, fileName, extractedText, resumeFile, resumeMimeType, projectId } = params;
  const supabase = getSupabaseClient();

  const resumePath = `calibration/${randomUUID()}/${fileName}`;
  const upload = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(resumePath, resumeFile, { contentType: resumeMimeType });
  if (upload.error) throw upload.error;

  const insert = await supabase
    .from("calibration_examples")
    .insert({
      label,
      note,
      file_name: fileName,
      resume_path: resumePath,
      resume_mime_type: resumeMimeType,
      extracted_text: extractedText,
      project_id: projectId ?? null,
      user_id: params.userId ?? null,
    })
    .select()
    .single<CalibrationExampleRow>();
  if (insert.error) throw insert.error;

  return rowToExample(insert.data);
}

export async function listCalibrationExamples(
  projectId?: number,
  userId?: string
): Promise<CalibrationExample[]> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from("calibration_examples")
    .select("id, label, note, file_name, resume_mime_type, extracted_text, project_id, created_at")
    .order("created_at", { ascending: false });

  if (projectId != null) query = query.eq("project_id", projectId);
  if (userId != null) query = query.eq("user_id", userId);

  const { data, error } = await query.returns<CalibrationExampleRow[]>();
  if (error) throw error;

  return (data ?? []).map(rowToExample);
}

export async function deleteCalibrationExample(id: number): Promise<void> {
  const supabase = getSupabaseClient();

  const { data: row } = await supabase
    .from("calibration_examples")
    .select("resume_path")
    .eq("id", id)
    .maybeSingle<Pick<CalibrationExampleRow, "resume_path">>();

  if (row) {
    // Best-effort: a missing/already-gone file shouldn't block deleting the record.
    await supabase.storage.from(RESUME_BUCKET).remove([row.resume_path]);
  }

  const { error } = await supabase.from("calibration_examples").delete().eq("id", id);
  if (error) throw error;
}
