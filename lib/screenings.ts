import { randomUUID } from "crypto";
import { getSupabaseClient, RESUME_BUCKET } from "./supabase";
import { extractResumeText } from "./parseResume";
import { generateFingerprint } from "./generateFingerprint";
import { hashResumeText, normalizeCandidateName } from "./resumeContentHash";
import { extractCandidateNameFromPdf, looksLikeMissingName } from "./extractCandidateNameFallback";
import {
  saveFingerprint,
  findDuplicateMatch,
  markDuplicatePair,
  findCrossProjectMatch,
  markHistoryAlertPair,
  getScreeningFraudSignals,
} from "./resumeFingerprints";
import { logAction } from "./screeningActions";
import { getProject } from "./projects";
import { getPrimaryTeamId } from "./teams";
import { getAuthUser } from "./auth";
import type {
  CandidateResult, CandidateStatus, CredibilityAssessment, FullTrackerData,
  Recommendation, RejectionHistoryEntry, ScreeningRecord, TrackerEntry, TrackerStage,
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
  history_alert_type: string | null;
  history_alert_match_id: number | null;
  name_match_id: number | null;
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
    ...(row.history_alert_type === "previously_seen" || row.history_alert_type === "known_fraud_pattern"
      ? { historyAlertType: row.history_alert_type }
      : {}),
    ...(row.history_alert_match_id != null ? { historyAlertMatchId: row.history_alert_match_id } : {}),
    ...(row.name_match_id != null ? { nameMatchId: row.name_match_id } : {}),
    ...(row.previous_status != null ? { previousStatus: row.previous_status } : {}),
    createdAt: row.created_at,
  };
}

// ── Name match (same-project, free) ─────────────────────────────────────────
//
// Neither the content hash nor the fraud-pattern fingerprint catches "two
// genuinely different resume files that happen to name the same candidate
// in this project" — a resume screener persona vs. a research-focused one,
// for example. Pure candidate_name comparison, no Claude call, informational
// only (never implies fraud the way duplicateFlag/historyAlertType do).

async function findNameMatchInProject(params: {
  projectId: number;
  candidateName: string;
  excludeScreeningId: number;
}): Promise<number | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("screenings")
    .select("id, candidate_name")
    .eq("project_id", params.projectId)
    .neq("id", params.excludeScreeningId)
    .returns<{ id: number; candidate_name: string }[]>();
  if (error || !data) return null;

  const target = normalizeCandidateName(params.candidateName);
  const match = data.find((row) => normalizeCandidateName(row.candidate_name) === target);
  return match?.id ?? null;
}

async function markNameMatchPair(idA: number, idB: number): Promise<void> {
  const supabase = getSupabaseClient();
  await Promise.all([
    supabase.from("screenings").update({ name_match_id: idB }).eq("id", idA),
    supabase.from("screenings").update({ name_match_id: idA }).eq("id", idB),
  ]);
}

// ── Rejection history (system-wide, any recruiter) ──────────────────────────
//
// Teti's request, 2026-07-10: since every candidate is now saved regardless
// of score, a recruiter should be able to see if a name-matched candidate
// was already rejected somewhere else in the system. Deliberately NOT scoped
// to project or team, unlike every other match signal in this file — "the
// whole system," not "my team." Own isolated queries (tracker → screenings →
// projects, joined in JS), never touches SCREENING_COLUMNS or
// getFullTrackerEntries' shared select.
//
// Requires reject_reason (supabase-migration-reject-reason.sql). Safe to
// call before that migration runs — the tracker.select() below will error,
// but this function isn't wired into any page that already works today, so
// nothing breaks; it just returns no results until the column exists.

export async function listRejectionHistory(): Promise<RejectionHistoryEntry[]> {
  const supabase = getSupabaseClient();

  const { data: rejected, error: trackerErr } = await supabase
    .from("tracker")
    .select("screening_id, reject_reason")
    .eq("stage", "Reject")
    .returns<{ screening_id: number; reject_reason: string | null }[]>();
  if (trackerErr || !rejected || rejected.length === 0) return [];

  const screeningIds = rejected.map((r) => r.screening_id);
  const { data: screeningRows, error: screeningErr } = await supabase
    .from("screenings")
    .select("id, candidate_name, project_id")
    .in("id", screeningIds)
    .returns<{ id: number; candidate_name: string; project_id: number | null }[]>();
  if (screeningErr || !screeningRows) return [];

  const projectIds = [...new Set(
    screeningRows.map((r) => r.project_id).filter((id): id is number => id != null)
  )];
  let projectNameById = new Map<number, string>();
  if (projectIds.length > 0) {
    const { data: projectRows } = await supabase
      .from("projects")
      .select("id, name")
      .in("id", projectIds)
      .returns<{ id: number; name: string }[]>();
    projectNameById = new Map((projectRows ?? []).map((p) => [p.id, p.name]));
  }

  const reasonByScreeningId = new Map(rejected.map((r) => [r.screening_id, r.reject_reason]));

  return screeningRows.map((row) => ({
    candidateName: row.candidate_name,
    projectName: row.project_id != null ? (projectNameById.get(row.project_id) ?? null) : null,
    reason: reasonByScreeningId.get(row.id) ?? null,
  }));
}

// Supabase Storage keys only allow \w / ! - . * ' ( ) space & $ @ = ; : + , ?
// — a raw candidate-uploaded filename (accents, %, ~ from 8.3-short-name
// exports, etc.) can easily fall outside that set and fail the upload with
// an opaque "Invalid key" error. The human-readable name is already stored
// separately in the `file_name` column for display, so the storage path
// itself only needs to be a valid, collision-resistant key — not pretty.
function sanitizeStorageFileName(name: string): string {
  const cleaned = name.replace(/[^\w!\-.*'() &$@=;:+,?]/g, "_");
  return cleaned.length > 0 ? cleaned : "resume";
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
  /**
   * Project's score_threshold (see lib/projects.ts, default 45). When
   * provided and the candidate's score falls below it, the screening is
   * saved directly as "archived" instead of "new_applicant" — Vlad's ask,
   * 2026-07-15, so below-threshold candidates don't clutter the active
   * pipeline. Omit (or pass undefined) to keep the old always-new_applicant
   * behavior, e.g. for callers with no project context.
   */
  scoreThreshold?: number;
}): Promise<{ id: number }> {
  const { result, jobDescription, resumeFile, resumeMimeType, linkedInMode, projectId, userId, scoreThreshold } = params;
  const supabase = getSupabaseClient();

  // Recover a missing candidate name before it ever reaches the DB (Teti's
  // bug report, 2026-07-13 — "Unknown (resume name not provided)" cards).
  // scoreCandidate.ts (do-not-touch) is honest when the resume TEXT it was
  // given has no discoverable name — confirmed root cause: some PDF export
  // tools place the header outside the extractable text layer entirely, so
  // there was genuinely nothing for it to find. Mutating result.candidateName
  // IN PLACE here (not reassigning a local copy) is deliberate: both callers
  // of saveScreening (app/api/screen-resumes/route.ts and
  // app/api/screenings/save-one/route.ts, both do-not-touch) push the same
  // `result` object into their own response before/around calling this
  // function and already rely on exactly this mutate-by-reference pattern
  // for `result.id = id` — so this fix reaches the immediate UI too, not
  // just the next reload, without touching either do-not-touch route.
  if (looksLikeMissingName(result.candidateName) && resumeMimeType === "application/pdf") {
    const recovered = await extractCandidateNameFromPdf(resumeFile).catch(() => null);
    if (recovered) result.candidateName = recovered;
  }

  // Denormalize team_id from the project (source of truth) so list queries
  // can filter with a plain .eq/.in instead of a join. Falls back to the
  // saving user's own primary team for the rare screening with no project.
  // Best-effort: a lookup failure must never block the save itself.
  let teamId: number | null = null;
  try {
    if (projectId != null) {
      const project = await getProject(projectId);
      teamId = project?.teamId ?? null;
    } else if (userId) {
      teamId = await getPrimaryTeamId(userId);
    }
  } catch (err) {
    console.error("Team lookup failed for screening (saved without team_id):", err);
  }

  const resumePath = `${randomUUID()}/${sanitizeStorageFileName(result.fileName)}`;
  const upload = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(resumePath, resumeFile, { contentType: resumeMimeType });
  if (upload.error) throw upload.error;

  // Auto-archive: below-threshold candidates are saved straight to
  // "archived" instead of "new_applicant" so they never clutter the active
  // pipeline. Vlad's ask, 2026-07-15 (AskUserQuestion: "Save directly as
  // Archived"). Only applies when a threshold was actually passed in —
  // callers with no project context keep the old unconditional behavior.
  const initialStatus: CandidateStatus =
    scoreThreshold !== undefined && result.score < scoreThreshold ? "archived" : "new_applicant";

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
      status: initialStatus,
      job_description: jobDescription,
      resume_path: resumePath,
      resume_mime_type: resumeMimeType,
      linkedin_mode: linkedInMode ?? false,
      project_id: projectId ?? null,
      user_id: userId ?? null,
      team_id: teamId,
    })
    .select("id")
    .single<{ id: number }>();
  if (insert.error) throw insert.error;

  const screeningId = insert.data.id;

  // Vlad's ask, 2026-07-15: the status dropdown should be usable right on
  // the ResultCard immediately after screening, not only once the recruiter
  // navigates to the Pipeline tab. ResultCard already renders StatusSelect
  // when `result.status !== undefined` (components/ResultCard.tsx) and both
  // do-not-touch callers of saveScreening already mutate this same `result`
  // object in place for `result.id` — so mutating `result.status` here too
  // (matching initialStatus computed above, whether that's "new_applicant"
  // or the auto-archive "archived") reaches the immediate API response with
  // zero changes to either do-not-touch route.
  result.status = initialStatus;

  // Best-effort, non-throwing (logAction swallows its own errors).
  //
  // Attribution needs the TRUE acting user, not the `userId` param above —
  // that comes from callers via userIdFilter(), which deliberately returns
  // undefined for admin (it was built as a query-scoping helper: "admin sees
  // everything, no filter needed"). Reusing it for attribution silently
  // dropped admin-run screenings from the Activity timeline. Re-resolving
  // the session user here fixes that without touching screen-resumes/route.ts
  // (do-not-touch) — both callers of saveScreening already require an
  // authenticated user before reaching this point, so this always succeeds.
  const actingUser = await getAuthUser().catch(() => null);
  await logAction({ screeningId, userId: actingUser?.id ?? userId, actionType: "created" });

  // Best-effort: fingerprinting/duplicate-detection failures must never block
  // a screening from being saved. Runs after the insert so a failure here
  // can't lose the screening itself.
  let becameDuplicate = false;
  try {
    const resumeText = await extractResumeText(result.fileName, resumeFile);

    // Cheap exact-match dedupe signal for the pre-screen duplicate check
    // (app/api/screen-resumes/check-existing) — independent of the fingerprint
    // below, stored even if fingerprint matching fails downstream.
    await supabase
      .from("screenings")
      .update({ resume_content_hash: hashResumeText(resumeText) })
      .eq("id", screeningId);

    const fingerprint = await generateFingerprint(resumeText);
    await saveFingerprint({ screeningId, projectId, teamId, fingerprint });
    const match = await findDuplicateMatch({
      projectId,
      excludeScreeningId: screeningId,
      fingerprint,
    });
    if (match) {
      await markDuplicatePair(screeningId, match.screeningId);
      becameDuplicate = true;
    }

    // Free candidate-name check — skipped when this save already became a
    // content duplicate (that pairing already implies a name match too;
    // showing both badges pointing at the same candidate is just noise).
    if (projectId != null && !becameDuplicate) {
      const nameMatchId = await findNameMatchInProject({
        projectId,
        candidateName: result.candidateName,
        excludeScreeningId: screeningId,
      });
      if (nameMatchId != null) {
        await markNameMatchPair(screeningId, nameMatchId);
      }
    }

    // Phase 1.4 — Candidate History Alert. Same fingerprint, different project,
    // same team: a resubmission signal distinct from same-project duplication
    // above. Only meaningful with both a project and a team to scope "cross
    // project" against — skip silently otherwise (e.g. no project assigned).
    if (projectId != null && teamId != null) {
      const crossMatch = await findCrossProjectMatch({
        teamId,
        excludeProjectId: projectId,
        excludeScreeningId: screeningId,
        fingerprint,
      });
      if (crossMatch) {
        const matchedSignals = await getScreeningFraudSignals(crossMatch.screeningId);
        const alertType =
          becameDuplicate || matchedSignals.duplicateFlag || matchedSignals.historyAlertType === "known_fraud_pattern"
            ? "known_fraud_pattern"
            : "previously_seen";
        await markHistoryAlertPair(screeningId, crossMatch.screeningId, alertType);
      }
    }
  } catch (err) {
    console.error("Duplicate fingerprinting failed (screening still saved):", err);
  }

  return { id: screeningId };
}

// ── List ───────────────────────────────────────────────────────────────────

const SCREENING_COLUMNS =
  "id, candidate_name, file_name, score, must_have_score, nice_to_have_score, summary, strengths, concerns, career_trajectory, recommendation, status, status_updated_at, job_description, resume_mime_type, linkedin_mode, flagged, flag_note, notes, lever_url, credibility, photo_url, linkedin_pdf_path, interview_questions, project_id, duplicate_flag, duplicate_match_id, history_alert_type, history_alert_match_id, name_match_id, previous_status, created_at";

/**
 * Fills in the matched candidate's name and project (name + id) for any
 * record carrying a Phase 1.4 history alert, so the UI can render "previously
 * seen in <project>" and link to it — the match is very often in a project
 * that isn't otherwise loaded on the current page (unlike same-project
 * duplicates, which the page's own screening list already contains).
 */
async function enrichHistoryAlerts(records: ScreeningRecord[]): Promise<ScreeningRecord[]> {
  const matchIds = [...new Set(records.map((r) => r.historyAlertMatchId).filter((id): id is number => id != null))];
  if (matchIds.length === 0) return records;

  const supabase = getSupabaseClient();
  const { data: matched, error } = await supabase
    .from("screenings")
    .select("id, candidate_name, project_id")
    .in("id", matchIds)
    .returns<{ id: number; candidate_name: string; project_id: number | null }[]>();
  if (error || !matched) return records; // best-effort — alert flag itself still renders without the link

  const projectIds = [...new Set(matched.map((m) => m.project_id).filter((id): id is number => id != null))];
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .in("id", projectIds)
    .returns<{ id: number; name: string }[]>();
  const projectNameById = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const matchedById = new Map(matched.map((m) => [m.id, m]));

  return records.map((r) => {
    if (r.historyAlertMatchId == null) return r;
    const m = matchedById.get(r.historyAlertMatchId);
    if (!m) return r;
    return {
      ...r,
      historyAlertMatchCandidateName: m.candidate_name,
      ...(m.project_id != null ? { historyAlertMatchProjectId: m.project_id } : {}),
      ...(m.project_id != null && projectNameById.has(m.project_id)
        ? { historyAlertMatchProjectName: projectNameById.get(m.project_id) }
        : {}),
    };
  });
}

/**
 * teamIds: undefined = no filter (admin, sees all). Empty array = recruiter
 * with no team membership, short-circuits to [] without hitting the DB.
 */
export async function listScreenings(
  query?: string,
  statuses?: CandidateStatus[],
  flaggedOnly?: boolean,
  projectId?: number,
  teamIds?: number[]
): Promise<ScreeningRecord[]> {
  if (teamIds != null && teamIds.length === 0) return [];
  const supabase = getSupabaseClient();

  let request = supabase
    .from("screenings")
    .select(SCREENING_COLUMNS)
    .order(statuses && statuses.length > 0 ? "score" : "created_at", { ascending: false })
    .limit(200);

  if (query?.trim()) request = request.ilike("candidate_name", `%${query.trim()}%`);
  if (statuses && statuses.length > 0) request = request.in("status", statuses);
  if (flaggedOnly) request = request.eq("flagged", true);
  if (projectId != null) request = request.eq("project_id", projectId);
  if (teamIds != null) request = request.in("team_id", teamIds);

  const { data, error } = await request.returns<ScreeningRow[]>();
  if (error) throw error;

  return enrichHistoryAlerts((data ?? []).map(rowToRecord));
}

export async function getScreeningsByIds(ids: number[]): Promise<ScreeningRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("screenings")
    .select(SCREENING_COLUMNS)
    .in("id", ids)
    .returns<ScreeningRow[]>();
  if (error) throw error;
  return enrichHistoryAlerts((data ?? []).map(rowToRecord));
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
    /** See ARCHIVE_REASONS (lib/types.ts) and supabase-migration-archive-reason.sql. */
    archiveReason?: string;
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
  // archive_reason column not yet confirmed run (supabase-migration-archive-reason.sql)
  // — see that file's header for the sequencing rationale.
  if (fields.archiveReason !== undefined) update.archive_reason = fields.archiveReason;
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

  // Clear reverse match pointers on whichever candidate(s) still reference
  // this one — duplicate_match_id/history_alert_match_id/name_match_id are
  // all set bidirectionally in pairs (markDuplicatePair/markHistoryAlertPair/
  // markNameMatchPair in this file and lib/resumeFingerprints.ts write both
  // sides), but nothing previously cleaned up the surviving side when one
  // half of a pair got deleted. Left alone, the other candidate's badge
  // ("Duplicate detected" / "Known fraud pattern" / "Previously seen" /
  // "Name match") would point at an id that no longer exists forever —
  // computeMatchClusters (lib/matchClusters.ts) already guards against this
  // for ring grouping via its idsInScope check, but the badge itself is
  // rendered directly off these fields regardless of clustering, so it would
  // still show a dead link. Found during the 2026-07-16 full-codebase audit.
  // Best-effort, non-blocking — a failure here must never stop the actual
  // delete.
  try {
    await Promise.all([
      supabase.from("screenings").update({ duplicate_flag: false, duplicate_match_id: null }).eq("duplicate_match_id", id),
      supabase.from("screenings").update({ history_alert_type: null, history_alert_match_id: null }).eq("history_alert_match_id", id),
      supabase.from("screenings").update({ name_match_id: null }).eq("name_match_id", id),
    ]);
  } catch (err) {
    console.error("Failed to clear reverse match pointers before delete (screening still deleted):", err);
  }

  const { error } = await supabase.from("screenings").delete().eq("id", id);
  if (error) throw error;
}

export async function getStatusCounts(
  projectId?: number,
  teamIds?: number[]
): Promise<Partial<Record<CandidateStatus, number>>> {
  if (teamIds != null && teamIds.length === 0) return {};
  const supabase = getSupabaseClient();
  let req = supabase.from("screenings").select("status");
  if (projectId != null) req = req.eq("project_id", projectId);
  if (teamIds != null) req = req.in("team_id", teamIds);
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
      // location column added 2026-07-15 (supabase-migration-tracker-location.sql,
      // NOT YET CONFIRMED RUN as of this write — run it before this write path
      // is exercised for real, or the upsert will fail with a missing-column
      // error the first time someone saves a Location value). next_step
      // removed the same day per Vlad's request ("remove it entirely").
      ...(fields.location !== undefined && { location: fields.location }),
      ...(fields.stepsCompleted !== undefined && { steps_completed: fields.stepsCompleted }),
      ...(fields.comments !== undefined && { comments: fields.comments }),
      ...(fields.immigration !== undefined && { immigration: fields.immigration }),
      ...(fields.onHold !== undefined && { on_hold: fields.onHold }),
      ...(fields.onHoldReason !== undefined && { on_hold_reason: fields.onHoldReason }),
      ...(fields.rejectReason !== undefined && { reject_reason: fields.rejectReason }),
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
  // location is deliberately NOT in this select yet — supabase-migration-
  // tracker-location.sql needs to be confirmed run first (see
  // upsertTrackerEntry's comment above and decisions-log.md, 2026-07-15).
  // This is the exact same sequencing reject_reason followed: land the write
  // path now, add the column to this shared select as a follow-up once the
  // migration is confirmed. Adding it here before then would 500 every
  // Tracker load for every screening (this select feeds the whole tab), not
  // just the one save — see feedback_migration_sequencing in the global
  // memory vault, this has caused two real outages before.
  const { data, error } = await supabase
    .from("tracker")
    .select("screening_id, stage, company, role, expected_level, steps_completed, comments, immigration, on_hold, on_hold_reason, reject_reason, scheduled, interview_date, previous_stage")
    .in("screening_id", screeningIds);
  if (error) throw error;
  const map: Record<number, FullTrackerData> = {};
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    map[row.screening_id as number] = {
      stage: (row.stage as TrackerStage) ?? undefined,
      company: (row.company as string) ?? undefined,
      role: (row.role as string) ?? undefined,
      expectedLevel: (row.expected_level as string) ?? undefined,
      stepsCompleted: (row.steps_completed as string) ?? undefined,
      comments: (row.comments as string) ?? undefined,
      immigration: (row.immigration as string) ?? undefined,
      onHold: (row.on_hold as boolean) ?? false,
      onHoldReason: (row.on_hold_reason as string) ?? undefined,
      rejectReason: (row.reject_reason as string) ?? undefined,
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
