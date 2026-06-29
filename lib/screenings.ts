import { randomUUID } from "crypto";
import { getSupabaseClient, RESUME_BUCKET } from "./supabase";
import type { CandidateResult, CandidateStatus, CredibilityAssessment, Recommendation, ScreeningRecord, TrackerEntry, TrackerStage } from "./types";

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
  career_trajectory: string | null;
  recommendation: Recommendation | null;
  status: CandidateStatus;
  status_updated_at: string | null;
  job_description: string;
  resume_path: string;
  resume_mime_type: string;
  flagged: boolean;
  flag_note: string | null;
  notes: string | null;
  credibility: CredibilityAssessment | null;
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
    ...(row.career_trajectory != null && { careerTrajectory: row.career_trajectory }),
    recommendation: row.recommendation,
    status: row.status,
    ...(row.status_updated_at != null && { statusUpdatedAt: row.status_updated_at }),
    jobDescription: row.job_description,
    resumeMimeType: row.resume_mime_type,
    flagged: row.flagged ?? false,
    ...(row.flag_note ? { flagNote: row.flag_note } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.credibility ? { credibility: row.credibility } : {}),
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
    career_trajectory: result.careerTrajectory ?? null,
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
  statuses?: CandidateStatus[],
  flaggedOnly?: boolean
): Promise<ScreeningRecord[]> {
  const supabase = getSupabaseClient();

  let request = supabase
    .from("screenings")
    .select(
      "id, candidate_name, file_name, score, must_have_score, nice_to_have_score, summary, strengths, concerns, career_trajectory, recommendation, status, status_updated_at, job_description, resume_mime_type, flagged, flag_note, notes, credibility, created_at"
    )
    .order(statuses && statuses.length > 0 ? "score" : "created_at", { ascending: false })
    .limit(200);

  if (query?.trim()) {
    request = request.ilike("candidate_name", `%${query.trim()}%`);
  }

  if (statuses && statuses.length > 0) {
    request = request.in("status", statuses);
  }

  if (flaggedOnly) {
    request = request.eq("flagged", true);
  }

  const { data, error } = await request.returns<ScreeningRow[]>();
  if (error) throw error;

  return (data ?? []).map(rowToRecord);
}

export async function updateScreeningNotes(id: number, notes: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("screenings")
    .update({ notes: notes.trim() || null })
    .eq("id", id);
  if (error) throw error;
}

export async function updateScreeningFlag(
  id: number,
  flagged: boolean,
  flagNote?: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("screenings")
    .update({ flagged, flag_note: flagged ? (flagNote ?? null) : null })
    .eq("id", id);
  if (error) throw error;
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

export async function getScreeningsByIds(ids: number[]): Promise<ScreeningRecord[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("screenings")
    .select(
      "id, candidate_name, file_name, score, must_have_score, nice_to_have_score, summary, strengths, concerns, career_trajectory, recommendation, status, status_updated_at, job_description, resume_mime_type, flagged, flag_note, notes, credibility, created_at"
    )
    .in("id", ids)
    .returns<ScreeningRow[]>();
  if (error) throw error;

  return (data ?? []).map(rowToRecord);
}

export async function updateScreeningCredibility(
  id: number,
  credibility: CredibilityAssessment
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("screenings")
    .update({ credibility })
    .eq("id", id);
  if (error) throw error;
}

// ── Tracker ──────────────────────────────────────────────────────────────────

interface TrackerRow {
  screening_id: number;
  stage: TrackerStage;
  lever_id: string;
  company: string;
  role: string;
  expected_level: string;
  next_step: string;
  steps_completed: string;
  comments: string;
  immigration: string;
  on_hold: boolean;
  on_hold_reason: string;
  order_index: number | null;
  created_at: string;
}

export async function getTrackerEntries(): Promise<TrackerEntry[]> {
  const supabase = getSupabaseClient();

  // Fetch all screenings with status = "interview"
  const { data: screenings, error: sErr } = await supabase
    .from("screenings")
    .select("id, candidate_name, file_name, score, job_description, created_at")
    .eq("status", "interview")
    .order("created_at", { ascending: false })
    .returns<Pick<ScreeningRow, "id" | "candidate_name" | "file_name" | "score" | "job_description" | "created_at">[]>();
  if (sErr) throw sErr;
  if (!screenings || screenings.length === 0) return [];

  const ids = screenings.map((s) => s.id);

  // Fetch tracker rows for those screenings
  const { data: trackerRows, error: tErr } = await supabase
    .from("tracker")
    .select("screening_id, stage, lever_id, company, role, expected_level, next_step, steps_completed, comments, immigration, on_hold, on_hold_reason, order_index, created_at")
    .in("screening_id", ids)
    .returns<TrackerRow[]>();
  if (tErr) throw tErr;

  const trackerMap = new Map<number, TrackerRow>();
  for (const row of trackerRows ?? []) {
    trackerMap.set(row.screening_id, row);
  }

  const mapped = screenings.map((s) => {
    const t = trackerMap.get(s.id);
    return {
      screeningId: s.id,
      candidateName: s.candidate_name,
      fileName: s.file_name,
      score: s.score,
      jobDescription: s.job_description,
      stage: t?.stage ?? "TA",
      leverId: t?.lever_id ?? "",
      company: t?.company ?? "",
      role: t?.role ?? "",
      expectedLevel: t?.expected_level ?? "",
      nextStep: t?.next_step ?? "",
      stepsCompleted: t?.steps_completed ?? "",
      comments: t?.comments ?? "",
      immigration: t?.immigration ?? "",
      onHold: t?.on_hold ?? false,
      onHoldReason: t?.on_hold_reason ?? "",
      orderIndex: t?.order_index ?? Infinity,
      createdAt: s.created_at,
    };
  });

  // Sort by explicit order first, fall back to created_at desc (already ordered above)
  mapped.sort((a, b) => {
    if (a.orderIndex === Infinity && b.orderIndex === Infinity) return 0;
    if (a.orderIndex === Infinity) return 1;
    if (b.orderIndex === Infinity) return -1;
    return a.orderIndex - b.orderIndex;
  });

  return mapped;
}

export async function upsertTrackerEntry(
  screeningId: number,
  fields: Partial<Omit<TrackerEntry, "screeningId" | "candidateName" | "fileName" | "score" | "jobDescription" | "createdAt">>
): Promise<void> {
  const supabase = getSupabaseClient();

  const payload: Record<string, unknown> = { screening_id: screeningId };
  if (fields.stage !== undefined) payload.stage = fields.stage;
  if (fields.leverId !== undefined) payload.lever_id = fields.leverId;
  if (fields.company !== undefined) payload.company = fields.company;
  if (fields.role !== undefined) payload.role = fields.role;
  if (fields.expectedLevel !== undefined) payload.expected_level = fields.expectedLevel;
  if (fields.nextStep !== undefined) payload.next_step = fields.nextStep;
  if (fields.stepsCompleted !== undefined) payload.steps_completed = fields.stepsCompleted;
  if (fields.comments !== undefined) payload.comments = fields.comments;
  if (fields.immigration !== undefined) payload.immigration = fields.immigration;
  if (fields.onHold !== undefined) payload.on_hold = fields.onHold;
  if (fields.onHoldReason !== undefined) payload.on_hold_reason = fields.onHoldReason;
  if (fields.orderIndex !== undefined) payload.order_index = fields.orderIndex;

  const { error } = await supabase
    .from("tracker")
    .upsert(payload, { onConflict: "screening_id" });
  if (error) throw error;
}

export async function reorderTrackerEntries(
  order: { screeningId: number; orderIndex: number }[]
): Promise<void> {
  const supabase = getSupabaseClient();
  const rows = order.map(({ screeningId, orderIndex }) => ({
    screening_id: screeningId,
    order_index: orderIndex,
  }));
  const { error } = await supabase
    .from("tracker")
    .upsert(rows, { onConflict: "screening_id" });
  if (error) throw error;
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
