import { randomUUID } from "crypto";
import { getSupabaseClient, RESUME_BUCKET } from "./supabase";
import { extractResumeText } from "./parseResume";
import { generateFingerprint } from "./generateFingerprint";
import { saveFingerprint, findDuplicateMatch, markDuplicatePair } from "./resumeFingerprints";
import { logAction } from "./screeningActions";
import type {
  CandidateResult, CandidateStatus, CredibilityAssessment, FullTrackerData,
  Recommendation, ScreeningRecord, TrackerEntry, TrackerStage,
} from "./types";

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
  linkedin_mode: boolean;
  flagged: boolean;
  flag_note: string | null;
  notes: string | null;
  lever_url: string | null;
  credibility: CredibilityAssessment | null;
  photo_url: string | null;
  linkedin_pdf_path: string | null;
  interview_questions: string[] | null;
  project_id: number | null;
  duplicate_flag: boolean | null;
  duplicate_match_id: number | null;
  previous_status: CandidateStatus | null;
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
    linkedInMode: row.linkedin_mode ?? false,
    flagged: row.flagged ?? false,
    ...(row.flag_note ? { flagNote: row.flag_note } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    ...(row.lever_url ? { leverUrl: row.lever_url } : {}),
    ...(row.credibility ? { credibility: row.credibility } : {}),
    ...(row.photo_url ? { photoUrl: row.photo_url } : {}),
    ...(row.linkedin_pdf_path ? { linkedInPdfPath: row.linkedin_pdf_path } : {}),
    ...(row.interview_questions ? { interviewQuestions: row.interview_questions } : {}),
    ...(row.project_id != null ? { projectId: row.project_id } : {}),
    duplicateFlag: row.duplicate_flag ?? false,
    ...(row.duplicate_match_id != null ? { duplicateMatchId: row.duplicate_match_id } : {}),
    ...(row.previous_status != null ? { previousStatus: row.previous_status } : {}),
    createdAt: row.created_at,
  };
}

// ── Save ───────────────────────────────────────────────────────────────────

export async function saveScreening(params: {
  result: CandidateResult;
  jobDescription: string;
  resumeFile: Buffer;
  resumeMimeType: string;
  linkedInMode?: boolean;
  projectId?: number;
  userId?: string;
}): Promise<{ id: number }> {
  const { result, jobDescription, resumeFile, resumeMimeType, linkedInMode, projectId, userId } = params;
  const supabase = getSupabaseClient();

  const resumePath = `${randomUUID()}/${result.fileName}`;
  const upload = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(resumePath, resumeFile, { contentType: resumeMimeType });
  if (upload.error) throw upload.error;

  const insert = await supabase
    .from("screenings")
    .insert({
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
      linkedin_mode: linkedInMode ?? false,
      project_id: projectId ?? null,
      user_id: userId ?? null,
    })
    .select("id")
    .single<{ id: number }>();
  if (insert.error) throw insert.error;

  const screeningId = insert.data.id;

  // Best-effort, non-throwing (logAction swallows its own errors).
  await logAction({ screeningId, userId, actionType: "created" });

  // Best-effort: fingerprinting/duplicate-detection failures must never block
  // a screening from being saved. Runs after the insert so a failure here
  // can't lose the screening itself.
  try {
    const resumeText = await extractResumeText(result.fileName, resumeFile);
    const fingerprint = await generateFingerprint(resumeText);
    await saveFingerprint({ screeningId, projectId, fingerprint });
    const match = await findDuplicateMatch({
      projectId,
      excludeScreeningId: screeningId,
      fingerprint,
    });
    if (match) {
      await markDuplicatePair(screeningId, match.screeningId);
    }
  } catch (err) {
    console.error("Duplicate fingerprinting failed (screening still saved):", err);
  }

  return { id: screeningId };
}

// ── List ───────────────────────────────────────────────────────────────────

export async function listScreenings(
  query?: string,
  statuses?: CandidateStatus[],
  flaggedOnly?: boolean,
  projectId?: number,
  userId?: string
): Promise<ScreeningRecord[]> {
  const supabase = getSupabaseClient();

  let request = supabase
    .from("screenings")
    .select(
      "id, candidate_name, file_name, score, must_have_score, nice_to_have_score, summary, strengths, concerns, career_trajectory, recommendation, status, status_updated_at, job_description, resume_mime_type, linkedin_mode, flagged, flag_note, notes, lever_url, credibility, photo_url, linkedin_pdf_path, interview_questions, project_id, duplicate_flag, duplicate_match_id, previous_status, created_at"
    )
    .order(statuses && statuses.length > 0 ? "score" : "created_at", { ascending: false })
    .limit(200);

  if (query?.trim()) request = request.ilike("candidate_name", `%${query.trim()}%`);
  if (statuses && statuses.length > 0) request = request.in("status", statuses);
  if (flaggedOnly) request = request.eq("flagged", true);
  if (projectId != null) request = request.eq("project_id", projectId);
  if (userId != null) request = request.eq("user_id", userId);

  const { data, error } = await request.returns<ScreeningRow[]>();
  if (error) throw error;

  return (data ?? []).map(rowToRecord);
}

export async function getScreeningsByIds(ids: number[]): Promise<ScreeningRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("screenings")
    .select(
      "id, candidate_name, file_name, score, must_have_score, nice_to_have_score, summary, strengths, concerns, career_trajectory, recommendation, status, status_updated_at, job_description, resume_mime_type, linkedin_mode, flagged, flag_note, notes, lever_url, credibility, photo_url, linkedin_pdf_path, interview_questions, project_id, duplicate_flag, duplicate_match_id, previous_status, created_at"
    )
    .in("id", ids)
    .returns<ScreeningRow[]>();
  if (error) throw error;
  return (data ?? []).map(rowToRecord);
}

// ── Get resume ─────────────────────────────────────────────────────────────

export async function getScreeningResume(
  id: number
): Promise<{ data: Buffer; mimeType: string; fileName: string }> {
  const supabase = getSupabaseClient();
  const { data: row, error: rowErr } = await supabase
    .from("screenings")
    .select("resume_path, resume_mime_type, file_name")
    .eq("id", id)
    .single<{ resume_path: string; resume_mime_type: string; file_name: string }>();
  if (rowErr || !row) throw rowErr ?? new Error("Not found");

  const download = await supabase.storage.from(RESUME_BUCKET).download(row.resume_path);
  if (download.error) throw download.error;

  const data = Buffer.from(await download.data.arrayBuffer());
  return { data, mimeType: row.resume_mime_type, fileName: row.file_name };
}

// ── Update ─────────────────────────────────────────────────────────────────

export async function updateScreening(
  id: number,
  fields: {
    status?: CandidateStatus;
    notes?: string;
    leverUrl?: string;
    flagged?: boolean;
    flagNote?: string;
    credibility?: CredibilityAssessment;
    careerTrajectory?: string;
    photoUrl?: string;
    linkedInPdfPath?: string;
    interviewQuestions?: string[];
  },
  actorUserId?: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const update: Record<string, unknown> = {};
  if (fields.status !== undefined) { update.status = fields.status; update.status_updated_at = new Date().toISOString(); }
  if (fields.notes !== undefined) update.notes = fields.notes;
  if (fields.leverUrl !== undefined) update.lever_url = fields.leverUrl;
  if (fields.flagged !== undefined) update.flagged = fields.flagged;
  if (fields.flagNote !== undefined) update.flag_note = fields.flagNote;
  if (fields.credibility !== undefined) update.credibility = fields.credibility;
  if (fields.careerTrajectory !== undefined) update.career_trajectory = fields.careerTrajectory;
  if (fields.photoUrl !== undefined) update.photo_url = fields.photoUrl;
  if (fields.linkedInPdfPath !== undefined) update.linkedin_pdf_path = fields.linkedInPdfPath;
  if (fields.interviewQuestions !== undefined) update.interview_questions = fields.interviewQuestions;
  if (Object.keys(update).length === 0) return;

  // Attribution needs the "before" value for status/flagged — everything else
  // (notes, credibility) is logged as an event without a value diff, since
  // diffing free text or a whole credibility object isn't useful in a timeline.
  let before: { status: CandidateStatus; flagged: boolean } | null = null;
  if (actorUserId && (fields.status !== undefined || fields.flagged !== undefined)) {
    const { data } = await supabase
      .from("screenings")
      .select("status, flagged")
      .eq("id", id)
      .maybeSingle<{ status: CandidateStatus; flagged: boolean }>();
    before = data;
  }

  const { error } = await supabase.from("screenings").update(update).eq("id", id);
  if (error) throw error;

  if (actorUserId) {
    if (fields.status !== undefined) {
      await logAction({ screeningId: id, userId: actorUserId, actionType: "status_change", fromValue: before?.status ?? null, toValue: fields.status });
    }
    if (fields.flagged !== undefined) {
      await logAction({
        screeningId: id,
        userId: actorUserId,
        actionType: fields.flagged ? "flagged" : "unflagged",
        fromValue: before?.flagged != null ? String(before.flagged) : null,
        toValue: String(fields.flagged),
      });
    }
    if (fields.notes !== undefined) {
      await logAction({ screeningId: id, userId: actorUserId, actionType: "note" });
    }
    if (fields.credibility !== undefined) {
      await logAction({ screeningId: id, userId: actorUserId, actionType: "credibility_check" });
    }
  }
}

export async function updateScreeningNotes(id: number, notes: string, actorUserId?: string): Promise<void> {
  return updateScreening(id, { notes }, actorUserId);
}

export async function updateScreeningCredibility(
  id: number,
  credibility: CredibilityAssessment,
  actorUserId?: string
): Promise<void> {
  return updateScreening(id, { credibility }, actorUserId);
}

export async function deleteScreening(id: number): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: row } = await supabase
    .from("screenings")
    .select("resume_path")
    .eq("id", id)
    .single<{ resume_path: string }>();
  if (row?.resume_path) {
    await supabase.storage.from(RESUME_BUCKET).remove([row.resume_path]);
  }
  const { error } = await supabase.from("screenings").delete().eq("id", id);
  if (error) throw error;
}

export async function getStatusCounts(
  projectId?: number,
  userId?: string
): Promise<Partial<Record<CandidateStatus, number>>> {
  const supabase = getSupabaseClient();
  let req = supabase.from("screenings").select("status");
  if (projectId != null) req = req.eq("project_id", projectId);
  if (userId != null) req = req.eq("user_id", userId);
  const { data, error } = await req.returns<{ status: CandidateStatus }[]>();
  if (error) throw error;
  const counts: Partial<Record<CandidateStatus, number>> = {};
  for (const row of data ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}

// ── Tracker ────────────────────────────────────────────────────────────────

export async function upsertTrackerEntry(
  screeningId: number,
  fields: Partial<Omit<TrackerEntry, "screeningId" | "createdAt">>,
  actorUserId?: string
): Promise<void> {
  const supabase = getSupabaseClient();

  let beforeStage: TrackerStage | null = null;
  if (actorUserId && fields.stage !== undefined) {
    const { data } = await supabase
      .from("tracker")
      .select("stage")
      .eq("screening_id", screeningId)
      .maybeSingle<{ stage: TrackerStage | null }>();
    beforeStage = data?.stage ?? null;
  }

  const { error } = await supabase.from("tracker").upsert(
    {
      screening_id: screeningId,
      ...(fields.stage !== undefined && { stage: fields.stage }),
      ...(fields.leverId !== undefined && { lever_id: fields.leverId }),
      ...(fields.company !== undefined && { company: fields.company }),
      ...(fields.role !== undefined && { role: fields.role }),
      ...(fields.expectedLevel !== undefined && { expected_level: fields.expectedLevel }),
      ...(fields.nextStep !== undefined && { next_step: fields.nextStep }),
      ...(fields.stepsCompleted !== undefined && { steps_completed: fields.stepsCompleted }),
      ...(fields.comments !== undefined && { comments: fields.comments }),
      ...(fields.immigration !== undefined && { immigration: fields.immigration }),
      ...(fields.onHold !== undefined && { on_hold: fields.onHold }),
      ...(fields.onHoldReason !== undefined && { on_hold_reason: fields.onHoldReason }),
      ...(fields.scheduled !== undefined && { scheduled: fields.scheduled }),
      ...(fields.interviewDate !== undefined && { interview_date: fields.interviewDate }),
      ...(fields.orderIndex !== undefined && { order_index: fields.orderIndex }),
    },
    { onConflict: "screening_id" }
  );
  if (error) throw error;

  if (actorUserId && fields.stage !== undefined) {
    await logAction({
      screeningId,
      userId: actorUserId,
      actionType: "stage_change",
      fromValue: beforeStage,
      toValue: fields.stage,
    });
  }
}

export async function getTrackerStages(
  screeningIds: number[]
): Promise<Record<number, TrackerStage>> {
  if (screeningIds.length === 0) return {};
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tracker")
    .select("screening_id, stage")
    .in("screening_id", screeningIds);
  if (error) throw error;
  const map: Record<number, TrackerStage> = {};
  for (const row of (data ?? []) as { screening_id: number; stage: TrackerStage }[]) {
    if (row.stage) map[row.screening_id] = row.stage;
  }
  return map;
}

export async function getFullTrackerEntries(
  screeningIds: number[]
): Promise<Record<number, FullTrackerData>> {
  if (screeningIds.length === 0) return {};
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tracker")
    .select("screening_id, stage, company, role, expected_level, next_step, steps_completed, comments, immigration, on_hold, on_hold_reason, scheduled, interview_date, previous_stage")
    .in("screening_id", screeningIds);
  if (error) throw error;
  const map: Record<number, FullTrackerData> = {};
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    map[row.screening_id as number] = {
      stage: (row.stage as TrackerStage) ?? undefined,
      company: (row.company as string) ?? undefined,
      role: (row.role as string) ?? undefined,
      expectedLevel: (row.expected_level as string) ?? undefined,
      nextStep: (row.next_step as string) ?? undefined,
      stepsCompleted: (row.steps_completed as string) ?? undefined,
      comments: (row.comments as string) ?? undefined,
      immigration: (row.immigration as string) ?? undefined,
      onHold: (row.on_hold as boolean) ?? false,
      onHoldReason: (row.on_hold_reason as string) ?? undefined,
      scheduled: (row.scheduled as boolean) ?? false,
      interviewDate: (row.interview_date as string) ?? undefined,
      previousStage: (row.previous_stage as TrackerStage) ?? undefined,
    };
  }
  return map;
}

export async function updateScreeningStatus(id: number, status: CandidateStatus, actorUserId?: string): Promise<void> {
  return updateScreening(id, { status }, actorUserId);
}

export async function updateScreeningFlag(id: number, flagged: boolean, flagNote?: string, actorUserId?: string): Promise<void> {
  return updateScreening(id, { flagged, ...(flagNote !== undefined && { flagNote }) }, actorUserId);
}
