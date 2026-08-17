import { randomUUID } from "crypto";
import { getSupabaseClient, RESUME_BUCKET } from "./supabase";
import { extractResumeText } from "./parseResume";
import { compareFingerprints, generateFingerprint, NAME_MATCH_MIN_SIMILARITY, type ResumeFingerprint } from "./generateFingerprint";
import { hashResumeText, normalizeCandidateName } from "./resumeContentHash";
import { extractCandidateNameFromPdf, looksLikeMissingName } from "./extractCandidateNameFallback";
import {
  saveFingerprint,
  findDuplicateMatch,
  markDuplicatePair,
  findCrossProjectMatch,
  markHistoryAlertPair,
  getScreeningFraudSignals,
  getFingerprintForScreening,
} from "./resumeFingerprints";
import { logAction } from "./screeningActions";
import { getProject } from "./projects";
import { getPrimaryTeamId } from "./teams";
import { getAuthUser } from "./auth";
import { getRecruiterEmailMap } from "./recruiters";
import { computeTargetCompanyBoost } from "./targetCompanyBoost";
import { detectLinkedIn } from "./assessCredibility";
import type {
  BlacklistEntry, CandidateResult, CandidateStatus, ChecklistEvaluation, CredibilityAssessment, FraudRiskAssessment, FullTrackerData,
  Recommendation, RejectionHistoryEntry, ScreeningRecord, TrackerEntry, TrackerStage,
} from "./types";
import { DEFAULT_AUTO_ARCHIVE_REASON } from "./types";

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
  archive_reason: string | null;
  agency_name: string | null;
  user_id: string | null;
  batch_id: string | null;
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
    ...(row.archive_reason ? { archiveReason: row.archive_reason } : {}),
    ...(row.agency_name ? { agencyName: row.agency_name } : {}),
    ...(row.user_id != null ? { recruiterId: row.user_id } : {}),
    ...(row.batch_id != null ? { batchId: row.batch_id } : {}),
    createdAt: row.created_at,
  };
}

/**
 * Resolves each record's recruiterId (raw auth user id) to a human-readable
 * recruiterEmail, mirroring lib/funnelview/data.ts's getFunnelData() pattern.
 * Separate from rowToRecord because the id->email lookup is one Supabase
 * Auth admin call for the whole batch, not per-row.
 */
async function attachRecruiterEmails(records: ScreeningRecord[]): Promise<ScreeningRecord[]> {
  if (!records.some((r) => r.recruiterId != null)) return records;
  const emailByUserId = await getRecruiterEmailMap();
  return records.map((r) =>
    r.recruiterId != null ? { ...r, recruiterEmail: emailByUserId.get(r.recruiterId) ?? r.recruiterId } : r
  );
}

// ── Name match (same-project, free) ─────────────────────────────────────────
//
// Neither the content hash nor the fraud-pattern fingerprint catches "two
// genuinely different resume files that happen to name the same candidate
// in this project" — a resume screener persona vs. a research-focused one,
// for example. No Claude call, informational only (never implies fraud the
// way duplicateFlag/historyAlertType do).
//
// Real bug found 2026-07-29 (Vlad, live): this used to be pure
// candidate_name text comparison with zero content corroboration — two
// candidates who happen to share an exact name but have completely
// different work experience got flagged as a possible match. Now requires a
// low fingerprint-similarity floor (NAME_MATCH_MIN_SIMILARITY, much lower
// than the 0.85 duplicate threshold — see its own comment in
// generateFingerprint.ts for why) before accepting the match at all. Fails
// open (keeps the old name-only behavior) if either side's fingerprint
// isn't available — fingerprinting can fail independently of scoring, and a
// missing fingerprint shouldn't silently kill this signal outright.

async function findNameMatchInProject(params: {
  projectId: number;
  candidateName: string;
  excludeScreeningId: number;
  fingerprint?: ResumeFingerprint;
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
  if (!match) return null;

  if (params.fingerprint) {
    const matchedFingerprint = await getFingerprintForScreening(match.id).catch(() => null);
    if (matchedFingerprint) {
      const similarity = compareFingerprints(params.fingerprint, matchedFingerprint);
      if (similarity < NAME_MATCH_MIN_SIMILARITY) return null;
    }
  }

  return match.id;
}

async function markNameMatchPair(idA: number, idB: number): Promise<void> {
  const supabase = getSupabaseClient();
  await Promise.all([
    supabase.from("screenings").update({ name_match_id: idB }).eq("id", idA),
    supabase.from("screenings").update({ name_match_id: idA }).eq("id", idB),
  ]);
}

// ── Cross-project name match (team-wide, informational, ephemeral) ─────────
//
// Added 2026-07-27 (Vlad: "just mentions that this person was also screened
// in a different project ... if during the screening it was detected").
// Phase 1.4's historyAlertType (below) already covers cross-project
// resubmission — but it matches on CONTENT fingerprint (skills hash,
// responsibility vectors, career arc), deliberately identity-blind by
// design (see Phase 1.1's comment). That means it can miss the exact case
// this ask is about: the SAME real person, screened for a meaningfully
// different role (e.g. FDE vs. a Data Architect role), whose resume reads
// completely differently between the two — same gap already noted for the
// same-project findNameMatchInProject() above, just crossing the project
// boundary too now. Pure candidate_name comparison, no Claude call, no new
// column — purely a heads-up mention on the immediate screening response,
// never implies fraud/duplication the way historyAlertType does, and
// deliberately NOT persisted to the DB (see decisions-log.md's matching
// entry for why this is scoped to "during the screening" only, not a
// standing Pipeline badge, at least for now).
//
// Same fingerprint-corroboration fix as findNameMatchInProject above
// (2026-07-29, Vlad: two different Charlie Wangs flagged as a possible
// match on name text alone) — this had the identical gap, just across the
// project boundary. Requires NAME_MATCH_MIN_SIMILARITY before accepting the
// match, fails open (keeps the old name-only behavior) if either side's
// fingerprint isn't available.
async function findCrossProjectNameMatch(params: {
  teamId: number;
  candidateName: string;
  excludeProjectId: number;
  excludeScreeningId: number;
  fingerprint?: ResumeFingerprint;
}): Promise<{ screeningId: number; projectId: number | null; score: number } | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("screenings")
    .select("id, candidate_name, project_id, score")
    .eq("team_id", params.teamId)
    .neq("id", params.excludeScreeningId)
    .returns<{ id: number; candidate_name: string; project_id: number | null; score: number }[]>();
  if (error || !data) return null;

  const target = normalizeCandidateName(params.candidateName);
  const match = data.find(
    (row) => row.project_id !== params.excludeProjectId && normalizeCandidateName(row.candidate_name) === target
  );
  if (!match) return null;

  if (params.fingerprint) {
    const matchedFingerprint = await getFingerprintForScreening(match.id).catch(() => null);
    if (matchedFingerprint) {
      const similarity = compareFingerprints(params.fingerprint, matchedFingerprint);
      if (similarity < NAME_MATCH_MIN_SIMILARITY) return null;
    }
  }

  return { screeningId: match.id, projectId: match.project_id, score: match.score };
}

// ── Transfer to another project (real status action) ────────────────────────
//
// Vlad's ask, 2026-07-29, then redesigned same day after a real bug report:
// initial version only lived on the status dropdown, always copied the
// source screening's own score over verbatim. Vlad tested it, hit a real
// failure (partial state — see the two-step status update below for the
// fix), and asked for a different shape: a dedicated "Transfer" button at
// the bottom of the card, with an option to actually re-screen against the
// destination project's JD (rather than always just carrying the old score
// over) when the candidate hasn't already been screened there.
//
// Three modes, chosen by the caller (app/api/history/[id]/transfer/route.ts)
// based on what the recruiter picked in the new TransferControl popover:
//   - "existing": the candidate already has a screening in the destination
//     project (found via findCandidateInProject) — no new row at all, the
//     original screening just points at that existing one.
//   - "copy": no existing screening there, recruiter chose not to re-score —
//     same behavior as the original design, carries the source's own result
//     over as-is (a new row, but zero extra Claude spend).
//   - "rescore": recruiter chose to actually screen for the destination
//     project — `rescoredResult` was already computed by
//     /transfer/preview (a real scoreCandidate call against the
//     destination JD, shown to the recruiter before they confirmed) and is
//     used here instead of the source's own result, so this never re-runs
//     scoring a second time.
//
// Reuses getScreeningResume() to re-read the original resume file from
// storage for "copy"/"rescore" — triggered from an already-saved Pipeline
// card with no File object in memory client-side (unlike the existing Fit
// Suggestion "Transfer to X" button, which runs during a live Screen tab
// session and still has the original upload on hand) — this is why this
// couldn't just reuse app/api/screenings/save-one/route.ts's existing
// transfer flow.
export async function transferScreeningToProject(params: {
  screeningId: number;
  destinationProjectId: number;
  actingUserId?: string;
  mode: "copy" | "rescore" | "existing";
  existingScreeningId?: number;
  rescoredResult?: CandidateResult;
}): Promise<{ newScreeningId: number; destinationProjectName: string }> {
  const supabase = getSupabaseClient();

  const destinationProject = await getProject(params.destinationProjectId);
  if (!destinationProject) throw new Error("Destination project not found");

  let newScreeningId: number;

  if (params.mode === "existing") {
    if (params.existingScreeningId == null) throw new Error("existingScreeningId required for mode \"existing\"");
    newScreeningId = params.existingScreeningId;
  } else {
    const { data: row, error } = await supabase
      .from("screenings")
      .select(
        "candidate_name, file_name, score, must_have_score, nice_to_have_score, summary, strengths, concerns, career_trajectory, recommendation, resume_path, resume_mime_type, linkedin_mode, agency_name"
      )
      .eq("id", params.screeningId)
      .single<{
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
        resume_path: string;
        resume_mime_type: string;
        linkedin_mode: boolean;
        agency_name: string | null;
      }>();
    if (error || !row) throw error ?? new Error("Screening not found");

    const download = await supabase.storage.from(RESUME_BUCKET).download(row.resume_path);
    if (download.error) throw download.error;
    const resumeBuffer = Buffer.from(await download.data.arrayBuffer());

    const result: CandidateResult =
      params.mode === "rescore" && params.rescoredResult
        ? params.rescoredResult
        : {
            fileName: row.file_name,
            candidateName: row.candidate_name,
            score: row.score,
            mustHaveScore: row.must_have_score ?? undefined,
            niceToHaveScore: row.nice_to_have_score ?? undefined,
            summary: row.summary,
            strengths: row.strengths,
            concerns: row.concerns,
            careerTrajectory: row.career_trajectory ?? undefined,
            recommendation: row.recommendation ?? "decline",
          };

    const saved = await saveScreening({
      result,
      jobDescription: destinationProject.jobDescription,
      resumeFile: resumeBuffer,
      resumeMimeType: row.resume_mime_type,
      linkedInMode: row.linkedin_mode,
      agencyName: row.agency_name ?? undefined,
      projectId: params.destinationProjectId,
      userId: params.actingUserId,
      scoreThreshold: destinationProject.scoreThreshold,
      actingUserId: params.actingUserId,
      teamId: destinationProject.teamId ?? null,
    });
    newScreeningId = saved.id;
  }

  // Vlad's ask, 2026-07-30: a transfer is a CERTAIN "same candidate, now in
  // a different project" — deterministically link source and destination
  // via the same historyAlertMatchId/historyAlertType edge matchClusters.ts
  // unions on, so the two screenings render merged ("Multiple roles")
  // instead of as two unrelated cards with no indication they're the same
  // person. Always "previously_seen" (never "known_fraud_pattern") — this
  // is an intentional recruiter action, not a suspicious duplicate.
  // Best-effort: a transfer that already succeeded shouldn't fail just
  // because this cosmetic link couldn't be written (e.g. the "existing"
  // mode's destination screening's own matching fields are untouched
  // either way, only this pair-link).
  //
  // For "copy"/"rescore" mode specifically, this also supersedes whatever
  // saveScreening()'s own findCrossProjectMatch call may or may not have
  // already found — that path only links two screenings when their
  // (freshly-regenerated) fingerprints happen to clear a similarity
  // threshold, which is unreliable for something we already know for
  // certain. Overwriting it here with the guaranteed source link is
  // strictly more correct, not a regression.
  try {
    // Guard: don't clobber a genuine known_fraud_pattern edge either side
    // might already carry from an unrelated match (rare, but that pointer
    // is load-bearing for a real fraud cluster elsewhere — this transfer
    // link should never downgrade it to a benign "previously_seen").
    const [sourceSignals, destSignals] = await Promise.all([
      getScreeningFraudSignals(params.screeningId),
      getScreeningFraudSignals(newScreeningId),
    ]);
    if (sourceSignals.historyAlertType !== "known_fraud_pattern" && destSignals.historyAlertType !== "known_fraud_pattern") {
      await markHistoryAlertPair(params.screeningId, newScreeningId, "previously_seen");
    }
  } catch (err) {
    // Non-fatal — see comment above. Logged (temporarily verbose,
    // 2026-07-30) so a silent failure here is actually diagnosable instead
    // of just quietly not clustering.
    console.error("Transfer history-alert linking failed (non-fatal):", err);
  }

  // Two-step update, split deliberately — round-43's first version did this
  // as one combined update and Vlad hit exactly the failure this avoids:
  // the destination screening got created successfully, but the single
  // update (status + the two migration-gated pointer columns) then threw
  // because supabase-migration-transfer-to-project.sql hadn't been run yet
  // ("column does not exist"), which surfaced as "Transfer failed" to the
  // recruiter even though a real copy now silently existed in the
  // destination project. Splitting it means the pointer columns failing
  // (missing migration) can never block the plain `status` flip below.
  //
  // CORRECTION, same day: this comment used to also claim the status flip
  // itself "needs no migration" since it's a plain text column — true of
  // the column TYPE, but wrong about there being nothing else to migrate.
  // A separate CHECK constraint (screenings_status_check, predates this
  // repo's migration-file convention) restricts status to a fixed value
  // list independently of the column type — a live test hit "violates
  // check constraint" until supabase-migration-status-transferred-check.sql
  // added 'transferred' to that list. See CandidateStatus's own comment in
  // lib/types.ts for the full story — and for why, as of 2026-08-02, the
  // original screening is archived (not flipped to "transferred") below.
  //
  // CHANGED 2026-08-02 (Vlad's ask — see lib/types.ts's CandidateStatus
  // comment): the original screening now becomes "archived" with
  // archiveReason "Transferred" instead of status "transferred". The
  // pointer-column update right below is unchanged — those columns are
  // independent of status and still power the "view destination" link.
  await updateScreening(params.screeningId, { status: "archived", archiveReason: "Transferred" }, params.actingUserId);
  try {
    const { error: pointerErr } = await supabase
      .from("screenings")
      .update({
        transferred_to_project_id: params.destinationProjectId,
        transferred_to_screening_id: newScreeningId,
      })
      .eq("id", params.screeningId);
    if (pointerErr) throw pointerErr;
  } catch {
    // Best-effort — see comment above. Status/archiveReason are already
    // correctly set regardless; only the destination link is missing until
    // the migration runs, same graceful-degradation contract as
    // enrichTransferInfo() below.
  }

  return { newScreeningId, destinationProjectName: destinationProject.name };
}

// Cheap, no-Claude-call check for whether this candidate (by normalized
// name) already has a screening sitting in the destination project —
// powers TransferControl's precheck step, so re-screening is only ever
// offered when there's genuinely nothing to reuse yet. Project-scoped
// (not team-scoped like findCrossProjectNameMatch), since this is checking
// one specific destination the recruiter already picked, not surfacing a
// candidate-wide search.
export async function findCandidateInProject(
  candidateName: string,
  projectId: number
): Promise<{ screeningId: number; score: number } | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("screenings")
    .select("id, candidate_name, score")
    .eq("project_id", projectId)
    .returns<{ id: number; candidate_name: string; score: number }[]>();
  if (error || !data) return null;

  const target = normalizeCandidateName(candidateName);
  const match = data.find((row) => normalizeCandidateName(row.candidate_name) === target);
  return match ? { screeningId: match.id, score: match.score } : null;
}

// Isolated, best-effort enrichment for the three transfer fields above —
// see supabase-migration-transfer-to-project.sql for why these are kept OUT
// of the shared SCREENING_COLUMNS select. Mirrors enrichHistoryAlerts()
// below exactly: a failure here (e.g. the migration hasn't run yet) just
// means transferred candidates show their bare "Transferred" pill with no
// destination name/link yet — the read never fails, never affects any
// other candidate.
//
// Widened 2026-08-02 to also include "archived" records, not just historical
// "transferred" ones — transferScreeningToProject() now archives the
// original screening instead of flipping it to "transferred" (see this
// file's own comment on that call), so a freshly-transferred candidate's
// pointer columns would otherwise never get enriched/read. Slightly more
// records checked per call (every archived candidate, not just transferred
// ones), but still a single batched query — the vast majority will simply
// come back with null pointer columns, which is harmless.
async function enrichTransferInfo(records: ScreeningRecord[]): Promise<ScreeningRecord[]> {
  const ids = records.filter((r) => r.status === "transferred" || r.status === "archived").map((r) => r.id);
  if (ids.length === 0) return records;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("screenings")
    .select("id, transferred_to_project_id, transferred_to_screening_id")
    .in("id", ids)
    .returns<{ id: number; transferred_to_project_id: number | null; transferred_to_screening_id: number | null }[]>();
  if (error || !data) return records; // best-effort — see comment above

  const byId = new Map(data.map((r) => [r.id, r]));
  const projectIds = [...new Set(data.map((r) => r.transferred_to_project_id).filter((id): id is number => id != null))];
  const names = await Promise.all(
    projectIds.map(async (pid) => [pid, (await getProject(pid).catch(() => null))?.name] as const)
  );
  const nameById = new Map(names);

  return records.map((r) => {
    const t = byId.get(r.id);
    if (!t) return r;
    return {
      ...r,
      ...(t.transferred_to_project_id != null ? { transferredToProjectId: t.transferred_to_project_id } : {}),
      ...(t.transferred_to_project_id != null && nameById.get(t.transferred_to_project_id)
        ? { transferredToProjectName: nameById.get(t.transferred_to_project_id) }
        : {}),
      ...(t.transferred_to_screening_id != null ? { transferredToScreeningId: t.transferred_to_screening_id } : {}),
    };
  });
}

// ── Cross-project candidate lookup (Fit Suggestion pre-check) ───────────────
//
// Vlad's ask, 2026-07-28: before spending a Claude call re-scoring a
// candidate against another project (the Cross-Project Fit Suggestion, see
// app/api/cross-project-fit/route.ts and its /gate sibling), check for free
// whether they're already screened there — if so there's nothing to
// suggest, so skip scoring that project entirely and just mention it
// instead. Same normalizeCandidateName comparison as
// findCrossProjectNameMatch above, just returning "which of these
// projectIds already have them" instead of a single best match. Scoped to
// an explicit project list the caller already team-scoped (via
// listProjects(teamIds)), so no team_id filter is needed here.
export async function findProjectsWithCandidate(params: {
  candidateName: string;
  projectIds: number[];
}): Promise<Map<number, { screeningId: number; score: number }>> {
  const { candidateName, projectIds } = params;
  if (projectIds.length === 0) return new Map();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("screenings")
    .select("id, project_id, candidate_name, score")
    .in("project_id", projectIds)
    .returns<{ id: number; project_id: number | null; candidate_name: string; score: number }[]>();
  if (error || !data) return new Map();

  const target = normalizeCandidateName(candidateName);
  const matched = new Map<number, { screeningId: number; score: number }>();
  for (const row of data) {
    if (row.project_id != null && normalizeCandidateName(row.candidate_name) === target) {
      matched.set(row.project_id, { screeningId: row.id, score: row.score });
    }
  }
  return matched;
}

// ── Cross-project matches (standing Pipeline badge) ──────────────────────
//
// Vlad's ask, 2026-07-30: simplify the "Already screened in" mention into a
// plain line — "Also screened in X — Scored Y" — and show it on every
// Pipeline card at all times, not just when the on-demand Cross-Project Fit
// Suggestion flow happens to have populated it (that flow only runs for
// below-threshold/marginal candidates — see ResultCard's eligibleForFitCheck
// — and findProjectsWithCandidate above only returns matches for an explicit
// projectIds list the caller already has in hand). This is a separate,
// batched, team-wide lookup: one query per Pipeline tab load (not one per
// candidate), so every card — regardless of score — can show its cross-
// project matches without spending a Claude call or an extra round trip per
// card. Same normalizeCandidateName comparison as every other name-match
// helper in this file; no fingerprint corroboration, since this is a plain
// informational mention, not a fraud/duplication signal (contrast
// findCrossProjectNameMatch above, which does corroborate).
export interface CrossProjectMatch {
  screeningId: number;
  projectId: number;
  projectName: string;
  score: number;
}

export async function findCrossProjectMatchesForProject(params: {
  teamId: number;
  projectId: number;
}): Promise<Map<number, CrossProjectMatch[]>> {
  const { teamId, projectId } = params;
  const supabase = getSupabaseClient();

  // This project's own candidates — what we're matching against.
  const { data: ownRows, error: ownError } = await supabase
    .from("screenings")
    .select("id, candidate_name")
    .eq("project_id", projectId)
    .returns<{ id: number; candidate_name: string }[]>();
  if (ownError || !ownRows || ownRows.length === 0) return new Map();

  // Every other screening on the same team, in one query.
  const { data: otherRows, error: otherError } = await supabase
    .from("screenings")
    .select("id, candidate_name, project_id, score")
    .eq("team_id", teamId)
    .neq("project_id", projectId)
    .returns<{ id: number; candidate_name: string; project_id: number | null; score: number }[]>();
  if (otherError || !otherRows || otherRows.length === 0) return new Map();

  const projectIds = [...new Set(otherRows.map((r) => r.project_id).filter((id): id is number => id != null))];
  const names = await Promise.all(
    projectIds.map(async (pid) => [pid, (await getProject(pid).catch(() => null))?.name] as const)
  );
  const nameById = new Map(names);

  const byNormalizedName = new Map<string, CrossProjectMatch[]>();
  for (const row of otherRows) {
    if (row.project_id == null) continue;
    const projectName = nameById.get(row.project_id);
    if (!projectName) continue;
    const key = normalizeCandidateName(row.candidate_name);
    const list = byNormalizedName.get(key) ?? [];
    list.push({ screeningId: row.id, projectId: row.project_id, projectName, score: row.score });
    byNormalizedName.set(key, list);
  }

  const result = new Map<number, CrossProjectMatch[]>();
  for (const own of ownRows) {
    const matches = byNormalizedName.get(normalizeCandidateName(own.candidate_name));
    if (matches && matches.length > 0) result.set(own.id, matches);
  }
  return result;
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
    .select("id, candidate_name, project_id, resume_content_hash")
    .in("id", screeningIds)
    .returns<{ id: number; candidate_name: string; project_id: number | null; resume_content_hash: string | null }[]>();
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
    contentHash: row.resume_content_hash ?? null,
  }));
}

// ── Blacklist (system-wide, any recruiter) ───────────────────────────────────
//
// Vlad's ask, 2026-07-31: when a candidate is archived, let the recruiter
// blacklist them; surface it during any future screening, for any recruiter,
// regardless of team. Same "system-wide, not team-scoped" precedent as
// listRejectionHistory above — own isolated query, never touches
// SCREENING_COLUMNS.
//
// Requires blacklisted/blacklist_reason (supabase-migration-blacklist.sql).
// Safe to call before that migration runs — the select below will error, but
// this function fails closed to [], so nothing breaks until it's wired in.

export async function listBlacklist(): Promise<BlacklistEntry[]> {
  const supabase = getSupabaseClient();

  const { data: rows, error } = await supabase
    .from("screenings")
    .select("candidate_name, project_id, blacklist_reason, resume_content_hash")
    .eq("blacklisted", true)
    .returns<{ candidate_name: string; project_id: number | null; blacklist_reason: string | null; resume_content_hash: string | null }[]>();
  if (error || !rows || rows.length === 0) return [];

  const projectIds = [...new Set(
    rows.map((r) => r.project_id).filter((id): id is number => id != null)
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

  return rows.map((row) => ({
    candidateName: row.candidate_name,
    reason: row.blacklist_reason ?? null,
    projectName: row.project_id != null ? (projectNameById.get(row.project_id) ?? null) : null,
    contentHash: row.resume_content_hash ?? null,
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

// Coerces a strengths/concerns array to plain strings before it ever reaches
// the DB — see the 2026-07-30 hardening comment where this is called, in
// saveScreening(), for why this exists. A single-key object like
// {"Skill": "..."} or {"item": "..."} (both observed live shapes) most
// likely holds the real intended string as its one value; anything else
// falls back to JSON.stringify so it's still a plain string, never an
// object that could crash a renderer expecting string[].
function normalizeInsightArray(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (typeof item === "string") return item;
    if (item != null && typeof item === "object" && !Array.isArray(item)) {
      const values = Object.values(item as Record<string, unknown>);
      if (values.length === 1 && typeof values[0] === "string") return values[0];
    }
    try {
      return JSON.stringify(item);
    } catch {
      return String(item);
    }
  });
}

// ── Save ───────────────────────────────────────────────────────────────────

export async function saveScreening(params: {
  result: CandidateResult;
  jobDescription: string;
  resumeFile: Buffer;
  resumeMimeType: string;
  linkedInMode?: boolean;
  /**
   * Free-text agency name, set only when this candidate was sourced via an
   * agency (mutually exclusive with linkedInMode in the ScreenTab UI, though
   * this function doesn't enforce that — see lib/sourceType.ts). Undefined
   * for Applicant/LinkedIn sources. Added 2026-07-20 — requires
   * supabase-migration-agency-source.sql to have run (this insert includes
   * the column unconditionally, every save, not just agency-sourced ones).
   */
  agencyName?: string;
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
  /**
   * Pre-extracted resume text, when the caller already has it (both current
   * callers do — app/api/screen-resumes/route.ts extracts once up front to
   * parallelize parsing across a batch, save-one/route.ts extracts once to
   * verify the file is readable). Passing it through here skips a second,
   * fully redundant PDF/DOCX parse that used to happen unconditionally below
   * — same resume, same bytes, same result, just recomputed. Optional and
   * falls back to extracting internally, so this is backward-compatible with
   * any future caller that doesn't have the text on hand. 2026-07-20 perf
   * pass, see decisions-log.md.
   */
  resumeText?: string;
  /**
   * Pre-computed fingerprint, when the caller already generated one (2026-07-20
   * perf pass — see decisions-log.md). Fingerprinting only needs the raw resume
   * text, not the score, so it doesn't actually have to wait for scoring to
   * finish — a caller that kicks it off in parallel with scoreCandidate() can
   * pass the result straight through here instead of letting this function
   * generate a second, redundant fingerprint sequentially. Optional; falls
   * back to generating it internally so this stays backward-compatible.
   * Pass explicit `null` (not just omit the field) when the caller already
   * attempted fingerprinting in parallel and it failed — signals "don't
   * retry, just skip duplicate/history matching for this save" rather than
   * "generate one internally," matching the existing best-effort behavior
   * (a fingerprinting failure must never block the screening from saving).
   */
  fingerprint?: ResumeFingerprint | null;
  /**
   * Groups screenings saved together in one screening run — a plain
   * client-generated UUID, written unconditionally on every save once wired
   * in (same "always write, never conditional" pattern as agencyName above
   * — see that field's comment). REQUIRES
   * supabase-migration-batch-id.sql to have run FIRST: once
   * app/api/screen-resumes/route.ts starts passing this on every call (see
   * that file's do-not-touch exception, 2026-07-28), every screening save
   * would throw if the column doesn't exist yet. Added for the durable
   * /projects/[id]/batches/[batchId] page — Vlad's ask, 2026-07-28.
   */
  batchId?: string;
  /**
   * Pre-resolved acting-user id, when the caller already has it (2026-07-29
   * perf pass — see decisions-log.md). Every field below this comment used
   * to trigger its own fresh getAuthUser()/getProject() round trip PER
   * RESUME being saved — wasteful when app/api/screen-resumes/route.ts
   * calls saveScreening() up to CONCURRENCY times per batch with the exact
   * same acting user and project every time. Optional and falls back to
   * resolving internally (same as before), so this stays backward-
   * compatible with any caller that doesn't have it on hand (e.g.
   * save-one/route.ts, a single-resume path where the redundancy doesn't
   * compound). See the comment where this used to live (just below) for
   * *why* the true session user has to be re-resolved rather than trusting
   * the `userId` param — that reasoning is unchanged, only WHERE the
   * resolution happens (once in the route, not once per resume) changed.
   */
  actingUserId?: string;
  /**
   * Pre-resolved team id, when the caller already has it (same 2026-07-29
   * perf pass). `null` is a valid, meaningful value (explicitly "no team"),
   * distinct from omitting the field entirely (falls back to the internal
   * getProject()/getPrimaryTeamId() lookup below, same as before).
   */
  teamId?: number | null;
  /**
   * Project's configured "score boost companies" — reuses JDAnalysis.wide/
   * narrow.targetCompanies (JD Analyzer, edited via the project's Filters
   * tab), combined+deduped by the caller (see lib/targetCompanyBoost.ts's
   * combineTargetCompanies). Optional — omit for callers with no project
   * context, same as scoreThreshold. Passed through by
   * app/api/screen-resumes/route.ts (do-not-touch exception, 2026-08-07,
   * Vlad's explicit sign-off) off the SAME project fetch already used for
   * linkedInContext/scoreThreshold/teamId — zero extra DB round trips.
   */
  targetCompanies?: string[];
  /**
   * Pre-computed checklist evaluation, 2026-08-17 (Vlad's ask: JD checklist
   * / "Trust badge"). Same precomputed-by-caller pattern as `fingerprint`
   * above, not `targetCompanies` — evaluateChecklist() needs a real Claude
   * call (unlike the plain substring match in targetCompanyBoost.ts), so
   * app/api/screen-resumes/route.ts runs it in the same Promise.all as
   * scoreCandidate()/generateFingerprint() and passes the finished result
   * straight through here. Optional — omit for callers with no project
   * checklist configured (save-one/route.ts, or a project with none set).
   * Pass explicit `null` when the caller attempted evaluation and it failed,
   * matching fingerprint's null-vs-omit convention.
   */
  checklistEvaluation?: ChecklistEvaluation | null;
}): Promise<{ id: number }> {
  const { result, jobDescription, resumeFile, resumeMimeType, linkedInMode, agencyName, projectId, userId, scoreThreshold, batchId, targetCompanies, checklistEvaluation } = params;
  const supabase = getSupabaseClient();

  // Real bug found 2026-07-20 (Vlad: "FunnelView didn't save the recruiter
  // who screened the candidate, even though it shows under Activity").
  // Root cause: the `user_id` column written below used to come straight
  // from the `userId` param — which both do-not-touch callers pass in via
  // `userIdFilter(user)`, a helper built for QUERY scoping ("admin sees
  // everything, no filter needed" — returns undefined for admin). Reusing
  // that same undefined-for-admin value as the actual attribution written
  // to the row meant every screening an admin ran themselves saved with
  // `user_id: null` — invisible to FunnelView's/Pipeline's recruiter
  // filter/column, both of which read straight off that column. The
  // Activity timeline's "created" log entry already worked around this
  // exact problem (see the logAction call below, added earlier) by
  // re-resolving the true session user instead of trusting the `userId`
  // param — this reuses that same resolution for the `user_id` column
  // itself, so both places agree on who actually did the screening.
  //
  // 2026-07-29: this used to be an unconditional getAuthUser() call, run
  // fresh for every resume in a batch even though it resolves to the exact
  // same user every time within one request. app/api/screen-resumes/route.ts
  // already calls getAuthUser() once at the top of the request (has to, to
  // authorize the request at all) — it now passes that resolved id through
  // as actingUserId, so a 3-resume batch does this lookup once instead of
  // three times. Falls back to the original fresh lookup when not provided.
  const resolvedActingUserId = params.actingUserId ?? (await getAuthUser().catch(() => null))?.id;

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
  // 2026-07-29 perf pass: skip the lookup entirely when the caller already
  // resolved it (see params.teamId's comment) — app/api/screen-resumes/
  // route.ts already fetches this project once per batch (for
  // linkedInContext/scoreThreshold) and now threads project.teamId straight
  // through, instead of every resume in the batch re-fetching the same
  // project row just for this one field.
  let teamId: number | null;
  if (params.teamId !== undefined) {
    teamId = params.teamId;
  } else {
    teamId = null;
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
  }

  // 2026-07-29 perf pass (see decisions-log.md): resume_content_hash used to
  // be written via a SEPARATE update() call issued well after the insert
  // below — a whole extra DB round trip per resume, for a value we can
  // resolve before the insert even happens (resumeText is already known
  // upfront in the common case — see params.resumeText's own comment).
  // Folded into the same insert now. The safety property the original fix
  // (2026-07-17) exists for is unchanged: a hashing failure here still can
  // never block the screening itself from saving, it just means this one
  // row saves with a null hash — same end state as before, just resolved
  // earlier and without a second write.
  let resumeText: string | null = params.resumeText ?? null;
  let resumeContentHash: string | null = null;
  try {
    if (resumeText == null) resumeText = await extractResumeText(result.fileName, resumeFile);
    resumeContentHash = hashResumeText(resumeText);
  } catch (err) {
    console.error("resume_content_hash computation failed (screening still saved):", err);
  }

  // Target-company score boost, 2026-08-07 (Vlad's ask: "add companies in
  // there that would increase the score if it matches with the candidate's
  // resume"). Deterministic, code-computed — see lib/targetCompanyBoost.ts's
  // own header for why this isn't baked into scoreCandidate.ts's prompt.
  // Applied BEFORE initialStatus is computed below, so a match can actually
  // help a borderline candidate clear the project's score threshold — that's
  // the point of the feature, not an incidental side effect. Mutates
  // result.score/result.targetCompanyMatches in place, same pattern as every
  // other result.* mutation in this function (strengths/concerns above,
  // status/archiveReason below) — reaches both do-not-touch callers'
  // immediate API response for free.
  if (targetCompanies && targetCompanies.length > 0 && resumeText) {
    const boost = computeTargetCompanyBoost(resumeText, targetCompanies);
    if (boost.matched) {
      result.score = Math.min(100, result.score + boost.bonus);
    }
    result.targetCompanyMatches = boost.matchedCompanies;
  }

  // JD checklist score delta, 2026-08-17 (Vlad's ask). Same deterministic-
  // application pattern as the target-company boost directly above — the
  // per-item point values and fired/not-fired decisions are already fully
  // resolved by the time this runs (see lib/evaluateChecklist.ts, called by
  // the route BEFORE saveScreening, in parallel with scoreCandidate()). This
  // block only applies the already-computed delta and clamps — same [0,100]
  // bound as the auto-archive threshold check below relies on. Runs after
  // the target-company boost so both adjustments stack on the model's raw
  // score, in the order they happened to be computed — order between the
  // two doesn't matter since both are plain addition before the single
  // clamp here.
  if (checklistEvaluation) {
    result.score = Math.max(0, Math.min(100, result.score + checklistEvaluation.scoreDelta));
    result.checklistEvaluation = checklistEvaluation;
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
  const initialArchiveReason = initialStatus === "archived" ? DEFAULT_AUTO_ARCHIVE_REASON : null;

  // 2026-07-30 hardening: scoreCandidate.ts's tool schema (do-not-touch)
  // declares strengths/concerns as string[], but a live Claude response can
  // still occasionally deviate from its own schema — confirmed via 2 real
  // screenings (out of 244) where strengths saved as an array of single-key
  // OBJECTS instead of strings (e.g. [{"Skill": "..."}]). Nothing validated
  // this shape before it reached the DB, and rendering an object directly
  // crashed the page with no error boundary to catch it (see
  // components/InsightList.tsx's matching render-side hardening — kept
  // even after this fix, since it's the last line of defense for whatever
  // shape deviation shows up next). Coercing here means a future deviation
  // never reaches the DB at all. Mutates result in place (same pattern as
  // every other result.* mutation in this function) so the immediate API
  // response is clean too, not just the saved row.
  result.strengths = normalizeInsightArray(result.strengths);
  result.concerns = normalizeInsightArray(result.concerns);

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
      archive_reason: initialArchiveReason,
      job_description: jobDescription,
      resume_path: resumePath,
      resume_mime_type: resumeMimeType,
      resume_content_hash: resumeContentHash,
      linkedin_mode: linkedInMode ?? false,
      agency_name: agencyName ?? null,
      batch_id: batchId ?? null,
      project_id: projectId ?? null,
      user_id: resolvedActingUserId ?? userId ?? null,
      team_id: teamId,
    })
    .select("id")
    .single<{ id: number }>();
  if (insert.error) throw insert.error;

  const screeningId = insert.data.id;

  // Current company/title/total-experience/LinkedIn, 2026-08-06 — do-not-
  // touch exception, Vlad's explicit sign-off. scoreCandidate.ts now
  // generates these in the same call as scoring (see that file's own
  // comment), so a NEW screening gets them automatically instead of only
  // via the manual "Regenerate trajectories" backfill button. Deliberately
  // a SEPARATE, best-effort call — NOT folded into the main insert above —
  // because these columns are still deferred-migration (supabase-migration-
  // current-role.sql may not have run yet in this environment); a single
  // INSERT with all fields bundled together would fail the WHOLE screening
  // save (including score/summary/everything else) if even one of these
  // columns doesn't exist. Splitting them out means a pre-migration
  // environment still saves the screening correctly — it just silently
  // skips these four fields until the migration runs, same fail-soft
  // pattern already used by the regenerate-trajectories route for the exact
  // same reason.
  try {
    await updateScreening(screeningId, {
      currentCompany: result.currentCompany,
      currentTitle: result.currentTitle,
      totalExperienceSummary: result.totalExperienceSummary,
      linkedinUrl: result.linkedinUrl,
      // Folded into this same best-effort call rather than a second one —
      // same deferred-migration reasoning (supabase-migration-target-
      // company-boost.sql), only set when the boost was actually evaluated
      // above (undefined = no target companies configured, skip entirely).
      ...(result.targetCompanyMatches !== undefined ? { targetCompanyMatches: result.targetCompanyMatches } : {}),
      // Same deferred-migration reasoning as targetCompanyMatches directly
      // above (supabase-migration-checklist.sql) — only set when a checklist
      // was actually configured+evaluated for this project (undefined = no
      // checklist, skip entirely, same convention as targetCompanyMatches).
      ...(result.checklistEvaluation !== undefined ? { checklistEvaluation: result.checklistEvaluation } : {}),
    });
  } catch {
    /* pre-migration or other non-fatal failure — the screening itself already saved above */
  }

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
  if (initialArchiveReason) result.archiveReason = initialArchiveReason;

  // Mirrors ScreeningRecord.linkedInMode onto the immediate API response so
  // the post-screening ResultCard can show the LinkedIn icon without waiting
  // for a reload. Added 2026-07-16.
  result.linkedInMode = linkedInMode ?? false;
  if (agencyName) result.agencyName = agencyName;

  // resume_is_linkedin, 2026-07-31 (Vlad's ask) — real-content LinkedIn
  // detection, independent of linkedin_mode (the recruiter's manual
  // "Sourced" channel toggle). Reuses detectLinkedIn() as-is (the same
  // 2-of-3-signal heuristic already tuned against false positives on
  // ordinary resumes, see lib/assessCredibility.ts), against the same
  // resumeText already resolved above — no extra extraction. Best-effort,
  // separate UPDATE (not folded into the insert above) because
  // supabase-migration-resume-is-linkedin.sql is NOT YET CONFIRMED RUN as of
  // this comment — a missing column here must never block the save itself,
  // same deferred-column discipline as duplicate_flag/history_alert_type
  // below. Mutates result in place so the immediate ResultCard gets the
  // right icon without waiting for a reload (same pattern as
  // result.linkedInMode above).
  try {
    if (resumeText == null) resumeText = await extractResumeText(result.fileName, resumeFile);
    const resumeIsLinkedIn = detectLinkedIn(resumeText);
    result.resumeIsLinkedIn = resumeIsLinkedIn;
    const { error: linkedInDetectError } = await supabase
      .from("screenings")
      .update({ resume_is_linkedin: resumeIsLinkedIn })
      .eq("id", screeningId);
    if (linkedInDetectError) throw linkedInDetectError;
  } catch (err) {
    console.error("resume_is_linkedin detection/write failed (screening still saved):", err);
  }

  // Best-effort, non-throwing (logAction swallows its own errors). Reuses
  // the same acting-user id resolved at the top of this function (now also
  // used for the `user_id` column itself — see the comment up there).
  await logAction({ screeningId, userId: resolvedActingUserId ?? userId, actionType: "created" });

  // Best-effort: fingerprinting/duplicate-detection failures must never block
  // a screening from being saved. Runs after the insert so a failure here
  // can't lose the screening itself.
  let becameDuplicate = false;

  // Resolve (not yet check) the fingerprint. In the common path this is
  // already provided by the caller (computed in parallel with scoring — see
  // params.fingerprint's comment) so this resolves instantly with no extra
  // await at all.
  let fingerprint: ResumeFingerprint | null = null;
  if (params.fingerprint === null) {
    // Caller already attempted fingerprinting in parallel with scoring and
    // it failed — don't retry (it would likely just fail again and cost
    // more time), skip duplicate/history matching for this save. Matches
    // the pre-existing best-effort guarantee: fingerprinting failures must
    // never block the screening from being saved.
    console.log("Fingerprint generation failed upstream (parallel with scoring) — duplicate/history matching skipped for this save, screening still saved fine.");
  } else if (params.fingerprint) {
    fingerprint = params.fingerprint;
  } else {
    try {
      if (resumeText == null) resumeText = await extractResumeText(result.fileName, resumeFile);
      fingerprint = await generateFingerprint(resumeText);
    } catch (err) {
      console.error("Fingerprint generation failed (screening still saved, duplicate/history matching skipped):", err);
    }
  }
  if (fingerprint) {
    await saveFingerprint({ screeningId, projectId, teamId, fingerprint }).catch((err) => {
      console.error("saveFingerprint failed (screening still saved):", err);
    });
  }

  // 2026-07-29 perf pass (see decisions-log.md): these four lookups are
  // independent reads — none needs another's result as input. The ACTIONS
  // taken afterward do depend on each other (e.g. "don't bother marking a
  // name-match pair if this already became a content duplicate" below), but
  // those actions are cheap/conditional and applied once all four results
  // are in, not gated ahead of time — so nothing about the final flags/
  // badges a recruiter sees changes, this just stops waiting for each
  // lookup one at a time (previously up to 4 sequential round trips; a
  // fingerprinting hiccup could even delay findNameMatchInProject, even
  // though it has nothing to do with fingerprints at all). Each is caught
  // independently so one lookup failing can never take out the others.
  const [duplicateMatch, nameMatchId, crossMatch, crossNameMatch] = await Promise.all([
    fingerprint
      ? findDuplicateMatch({ projectId, excludeScreeningId: screeningId, fingerprint }).catch((err) => {
          console.error("Duplicate match lookup failed (screening still saved):", err);
          return null;
        })
      : Promise.resolve(null),
    projectId != null
      ? findNameMatchInProject({ projectId, candidateName: result.candidateName, excludeScreeningId: screeningId, fingerprint: fingerprint ?? undefined }).catch((err) => {
          console.error("Name match lookup failed (screening still saved):", err);
          return null;
        })
      : Promise.resolve(null),
    // Phase 1.4 — Candidate History Alert. Same fingerprint, different
    // project, same team: a resubmission signal distinct from same-project
    // duplication above. Only meaningful with both a project and a team to
    // scope "cross project" against — skip silently otherwise.
    fingerprint && projectId != null && teamId != null
      ? findCrossProjectMatch({ teamId, excludeProjectId: projectId, excludeScreeningId: screeningId, fingerprint }).catch((err) => {
          console.error("Cross-project fingerprint match lookup failed (screening still saved):", err);
          return null;
        })
      : Promise.resolve(null),
    projectId != null && teamId != null
      ? findCrossProjectNameMatch({ teamId, candidateName: result.candidateName, excludeProjectId: projectId, excludeScreeningId: screeningId, fingerprint: fingerprint ?? undefined }).catch((err) => {
          console.error("Cross-project name match lookup failed (screening still saved):", err);
          return null;
        })
      : Promise.resolve(null),
  ]);

  if (duplicateMatch) {
    becameDuplicate = true;
    try {
      await markDuplicatePair(screeningId, duplicateMatch.screeningId);
      result.duplicateFlag = true;
      result.duplicateMatchId = duplicateMatch.screeningId;
      // Best-effort name lookup so the badge can show who it matched without
      // a second round trip from the client — failure here just means the
      // badge renders without a name, never blocks the save.
      const { data: matchedRow } = await supabase
        .from("screenings")
        .select("candidate_name")
        .eq("id", duplicateMatch.screeningId)
        .single<{ candidate_name: string }>();
      if (matchedRow) result.duplicateMatchCandidateName = matchedRow.candidate_name;
    } catch (err) {
      console.error("Marking duplicate pair failed (screening still saved):", err);
    }
  }

  // Free candidate-name check — skipped when this save already became a
  // content duplicate (that pairing already implies a name match too;
  // showing both badges pointing at the same candidate is just noise).
  if (nameMatchId != null && !becameDuplicate) {
    try {
      await markNameMatchPair(screeningId, nameMatchId);
    } catch (err) {
      console.error("Marking name-match pair failed (screening still saved):", err);
    }
  }

  if (crossMatch) {
    try {
      const matchedSignals = await getScreeningFraudSignals(crossMatch.screeningId);
      const alertType =
        becameDuplicate || matchedSignals.duplicateFlag || matchedSignals.historyAlertType === "known_fraud_pattern"
          ? "known_fraud_pattern"
          : "previously_seen";
      await markHistoryAlertPair(screeningId, crossMatch.screeningId, alertType);
      result.historyAlertType = alertType;
      result.historyAlertMatchId = crossMatch.screeningId;
      // Best-effort lookup of the matched candidate's name + project so the
      // banner can render immediately post-screening without a second
      // round trip — same non-fatal pattern as the duplicate lookup above.
      const { data: matchedRow } = await supabase
        .from("screenings")
        .select("candidate_name, project_id")
        .eq("id", crossMatch.screeningId)
        .single<{ candidate_name: string; project_id: number | null }>();
      if (matchedRow) {
        result.historyAlertMatchCandidateName = matchedRow.candidate_name;
        if (matchedRow.project_id != null) {
          result.historyAlertMatchProjectId = matchedRow.project_id;
          const matchedProject = await getProject(matchedRow.project_id).catch(() => null);
          if (matchedProject) result.historyAlertMatchProjectName = matchedProject.name;
        }
      }
    } catch (err) {
      console.error("Cross-project history alert failed (screening still saved):", err);
    }
  }

  // Skip if this is the exact same screening historyAlertType (above)
  // already matched — showing two banners pointing at the identical
  // candidate/project would just be noise. Different matched screening
  // (e.g. a third project) still shows both.
  if (crossNameMatch && crossNameMatch.screeningId !== result.historyAlertMatchId) {
    try {
      result.crossProjectNameMatchScreeningId = crossNameMatch.screeningId;
      result.crossProjectNameMatchScore = crossNameMatch.score;
      if (crossNameMatch.projectId != null) {
        result.crossProjectNameMatchProjectId = crossNameMatch.projectId;
        const matchedProject = await getProject(crossNameMatch.projectId).catch(() => null);
        if (matchedProject) result.crossProjectNameMatchProjectName = matchedProject.name;
      }
    } catch (err) {
      console.error("Cross-project name match enrichment failed (screening still saved):", err);
    }
  }

  return { id: screeningId };
}

// ── List ───────────────────────────────────────────────────────────────────

// batch_id is deliberately NOT in this shared select — see the
// [[feedback_migration_sequencing]] rule (global memory vault): adding a new
// column to SCREENING_COLUMNS before its migration is confirmed run has
// caused two real outages (candidates vanishing entirely, 2026-07-09 and
// 2026-07-10). listScreeningsByBatch() below uses its own isolated select
// instead, so the new batch-results page can fail gracefully on its own if
// the migration hasn't run yet, without touching Pipeline/All Candidates/
// every other hot path that reads through this constant.
const SCREENING_COLUMNS =
  "id, candidate_name, file_name, score, must_have_score, nice_to_have_score, summary, strengths, concerns, career_trajectory, recommendation, status, status_updated_at, job_description, resume_mime_type, linkedin_mode, flagged, flag_note, notes, lever_url, credibility, photo_url, linkedin_pdf_path, interview_questions, project_id, duplicate_flag, duplicate_match_id, history_alert_type, history_alert_match_id, name_match_id, previous_status, archive_reason, agency_name, user_id, created_at";

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
 * checklist_evaluation, 2026-08-17 (Vlad's ask) — deliberately a SEPARATE,
 * scoped, best-effort query, NOT folded into SCREENING_COLUMNS/rowToRecord.
 * This follows a real incident already documented in
 * lib/funnelview/data.ts's fetchCurrentRoleColumn (2026-08-06): bundling a
 * not-yet-migrated column into the shared select made the WHOLE query fail,
 * silently wiping out unrelated already-populated columns for every
 * screening on the page, not just the missing one. Scoped with `.in("id",
 * ...)` to just the records already being returned (unlike
 * fetchCurrentRoleColumn's whole-table fetch) since this runs on every
 * Pipeline/All Candidates load, not just FunnelView's export.
 */
async function attachChecklistEvaluations(records: ScreeningRecord[]): Promise<ScreeningRecord[]> {
  if (records.length === 0) return records;
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from("screenings")
      .select("id, checklist_evaluation")
      .in("id", records.map((r) => r.id))
      .returns<{ id: number; checklist_evaluation: ChecklistEvaluation | null }[]>();
    if (error) throw error;
    const byId = new Map((data ?? []).map((r) => [r.id, r.checklist_evaluation]));
    return records.map((r) => {
      const ev = byId.get(r.id);
      return ev ? { ...r, checklistEvaluation: ev } : r;
    });
  } catch (err) {
    console.error("checklist_evaluation unavailable (migration likely not run yet) — degrading to undefined for this field only:", err);
    return records;
  }
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

  // No .limit() here — there used to be a hardcoded .limit(200), with no
  // decisions-log/open-questions entry anywhere explaining why 200 was
  // chosen (looks like an unflagged, undocumented safety cap from early in
  // the project, back when 200 candidates was more than this app would ever
  // see). Real bug, found 2026-07-27 (Vlad: "the numbers in the pipeline
  // don't update, it stopped adding up at 200") — every count that reads
  // through listScreenings (Pipeline tab counts, All Candidates counts,
  // status/stage filters, search) silently stopped growing past 200 rows the
  // moment a project or team's real candidate count crossed that line, which
  // is exactly what the Brillio pilot's real usage volume was starting to
  // hit. Removed outright rather than raised to a bigger number, since any
  // fixed cap recreates the same silent-cliff bug later, just at a higher
  // count.
  let request = supabase
    .from("screenings")
    .select(SCREENING_COLUMNS)
    .order(statuses && statuses.length > 0 ? "score" : "created_at", { ascending: false });

  if (query?.trim()) request = request.ilike("candidate_name", `%${query.trim()}%`);
  if (statuses && statuses.length > 0) request = request.in("status", statuses);
  if (flaggedOnly) request = request.eq("flagged", true);
  if (projectId != null) request = request.eq("project_id", projectId);
  if (teamIds != null) request = request.in("team_id", teamIds);

  const { data, error } = await request.returns<ScreeningRow[]>();
  if (error) throw error;

  return attachRecruiterEmails(
    await attachChecklistEvaluations(await enrichTransferInfo(await enrichHistoryAlerts((data ?? []).map(rowToRecord))))
  );
}

export async function getScreeningsByIds(ids: number[]): Promise<ScreeningRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("screenings")
    .select(SCREENING_COLUMNS)
    .in("id", ids)
    .returns<ScreeningRow[]>();
  if (error) throw error;
  return attachRecruiterEmails(
    await attachChecklistEvaluations(await enrichTransferInfo(await enrichHistoryAlerts((data ?? []).map(rowToRecord))))
  );
}

/**
 * Screenings saved together in one screening run — powers the durable
 * /projects/[id]/batches/[batchId] page (Vlad's ask, 2026-07-28). Its own
 * isolated select (SCREENING_COLUMNS + batch_id) rather than reusing the
 * shared SCREENING_COLUMNS constant — see that constant's comment. This
 * means if supabase-migration-batch-id.sql hasn't run yet, only this one
 * function fails (caught by the API route, surfaced as a normal error to
 * just this page) instead of breaking Pipeline/All Candidates/every other
 * page that reads through the shared constant.
 *
 * projectId is required, not just batchId — a UUID is already effectively
 * unguessable, but scoping to the project it claims to belong to is a
 * cheap extra correctness check and matches the URL shape.
 */
export async function listScreeningsByBatch(projectId: number, batchId: string): Promise<ScreeningRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("screenings")
    .select(`${SCREENING_COLUMNS}, batch_id`)
    .eq("project_id", projectId)
    .eq("batch_id", batchId)
    .order("score", { ascending: false })
    .returns<ScreeningRow[]>();
  if (error) throw error;
  return attachRecruiterEmails(await enrichTransferInfo(await enrichHistoryAlerts((data ?? []).map(rowToRecord))));
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

/**
 * Single-purpose helper (mirrors getScreeningResume above) for
 * app/api/assess-credibility/route.ts's positive-scoring feature added
 * 2026-07-29 — deliberately just the one column rather than
 * getScreeningsByIds' full SCREENING_COLUMNS + enrichment pipeline, which
 * this call site has no use for. Returns [] rather than throwing on any
 * failure (missing row, RLS, etc.) — a credibility check should never fail
 * just because the original concerns couldn't be fetched, it should just
 * skip the resolvedConcerns feature for that run.
 */
export async function getScreeningConcerns(id: number): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("screenings")
    .select("concerns")
    .eq("id", id)
    .maybeSingle<{ concerns: string[] | null }>();
  if (error || !data) return [];
  return data.concerns ?? [];
}

/**
 * Archive Fits, 2026-07-30 — isolated read for lib/generateRoleFit.ts's
 * input plus the current suggested_role_fits array. summary/strengths/
 * career_trajectory are already in the shared SCREENING_COLUMNS select, but
 * suggested_role_fits is NOT (see supabase-migration-archive-fits.sql —
 * not yet confirmed run), so this fetches everything in one isolated query
 * rather than mixing a SCREENING_COLUMNS read with a second deferred-column
 * read. Same isolated-select pattern as getScreeningConcerns above.
 */
export async function getScreeningRoleFitContext(id: number): Promise<{
  summary: string;
  strengths: string[];
  careerTrajectory?: string;
  suggestedRoleFits: string[];
} | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("screenings")
    .select("summary, strengths, career_trajectory, suggested_role_fits")
    .eq("id", id)
    .maybeSingle<{
      summary: string;
      strengths: string[];
      career_trajectory: string | null;
      suggested_role_fits: string[] | null;
    }>();
  if (error || !data) return null;
  return {
    summary: data.summary,
    strengths: data.strengths ?? [],
    ...(data.career_trajectory != null ? { careerTrajectory: data.career_trajectory } : {}),
    suggestedRoleFits: data.suggested_role_fits ?? [],
  };
}

/**
 * Which screenings already have current_company/current_title/
 * total_experience_summary/linkedin_url set — 2026-08-04, added so the
 * "Regenerate trajectories" backfill button (Settings tab) can skip
 * candidates that already have them instead of re-running a Claude call
 * (cost + time) on every candidate in a role each time it's clicked.
 * Extended to all 4 fields 2026-08-06 — originally only checked the first
 * two, which meant candidates backfilled BEFORE totalExperienceSummary/
 * linkedinUrl existed would silently stay skipped forever, never picking up
 * the newer fields. Same deferred-column, fail-soft pattern as
 * getFraudCalibrationExampleByScreeningId — if
 * supabase-migration-current-role.sql hasn't run yet (or is missing any of
 * these 4 columns), this returns an empty map, which the caller correctly
 * reads as "everyone is still missing it" (safe: just means redundant
 * reprocessing until the migration catches up, never hides real data).
 */
export async function getCurrentRoleStatus(
  screeningIds: number[]
): Promise<
  Map<
    number,
    { currentCompany: string | null; currentTitle: string | null; totalExperienceSummary: string | null; linkedinUrl: string | null }
  >
> {
  if (screeningIds.length === 0) return new Map();
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("screenings")
      .select("id, current_company, current_title, total_experience_summary, linkedin_url")
      .in("id", screeningIds)
      .returns<
        { id: number; current_company: string | null; current_title: string | null; total_experience_summary: string | null; linkedin_url: string | null }[]
      >();
    if (error) throw error;
    return new Map(
      (data ?? []).map((r) => [
        r.id,
        {
          currentCompany: r.current_company,
          currentTitle: r.current_title,
          totalExperienceSummary: r.total_experience_summary,
          linkedinUrl: r.linkedin_url,
        },
      ])
    );
  } catch {
    return new Map();
  }
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
    /**
     * Whether the cross-reference doc stored at linkedInPdfPath is an actual
     * LinkedIn profile PDF vs. a second resume version — computed via
     * detectLinkedIn() in app/api/assess-credibility/route.ts, previously
     * discarded after steering the credibility-assessment prompt. Persisted
     * so the Interview View document popup can label the tab correctly
     * instead of always saying "LinkedIn". Requires
     * supabase-migration-cross-ref-doc-type.sql — NOT YET CONFIRMED RUN as of
     * this comment; see that file's header for the sequencing rationale.
     */
    crossRefIsLinkedIn?: boolean;
    /**
     * Manually-triggered fraud risk check result (FraudRiskChecker.tsx, only
     * ever offered at score >= 75). Requires
     * supabase-migration-fraud-calibration.sql — NOT YET CONFIRMED RUN as of
     * this comment. Written conditionally same as crossRefIsLinkedIn above,
     * and every caller wraps this update in .catch(() => {}) so a missing
     * column can never fail the fraud-risk-check response itself, only skip
     * persisting it.
     */
    fraudRisk?: FraudRiskAssessment;
    interviewQuestions?: string[];
    /** See ARCHIVE_REASONS (lib/types.ts) and supabase-migration-archive-reason.sql. */
    archiveReason?: string;
    /**
     * Editable post-save, 2026-07-20 (Vlad's ask: "add an option to change
     * the source on the result card in Pipeline"). Source was previously
     * only ever set once, at screening time — this lets a recruiter correct
     * or set it later (e.g. they forgot to flip to Agency before screening).
     * Passing linkedInMode: true does NOT retroactively re-score the
     * candidate — scoreCandidate.ts (do-not-touch) already ran once at save
     * time with whatever mode was active then; this only changes the label/
     * scoring-mode metadata going forward, matching how archiveReason and
     * every other field here is a pure metadata patch, never a re-run of
     * any Claude call.
     */
    linkedInMode?: boolean;
    agencyName?: string;
    /**
     * Rescore fields, added 2026-07-27 (Vlad's ask: "add a rescreen button on
     * actual pipeline cards") — app/api/history/[id]/rescreen/route.ts is the
     * only caller. Deliberately excludes candidateName, fileName, and status:
     * a rescore refreshes the scoring output against the current JD/
     * calibration library, it doesn't re-identify the candidate or move them
     * off whatever stage a recruiter already parked them on.
     */
    score?: number;
    mustHaveScore?: number;
    niceToHaveScore?: number;
    summary?: string;
    strengths?: string[];
    concerns?: string[];
    recommendation?: Recommendation;
    /**
     * Archive Fits, 2026-07-30 — full replacement array, not an append; the
     * caller (PATCH /api/history/[id]) reads the current array via
     * getScreeningRoleFitContext, appends, and writes the whole thing back.
     * Requires supabase-migration-archive-fits.sql — NOT YET CONFIRMED RUN,
     * same deferred-column pattern as fraudRisk/crossRefIsLinkedIn above.
     */
    suggestedRoleFits?: string[];
    /**
     * Blacklist, 2026-07-31 (Vlad's ask) — set from the archive-reason
     * picker's own checkbox (StatusStageControl.tsx). Requires
     * supabase-migration-blacklist.sql — NOT YET CONFIRMED RUN, same
     * deferred-column pattern as suggestedRoleFits/fraudRisk above. Every
     * caller wraps this in .catch(() => {}) so a missing column can't fail
     * the surrounding request.
     */
    blacklisted?: boolean;
    blacklistReason?: string | null;
    /**
     * Current employer/title, 2026-08-04 (Vlad's ask: FunnelView Excel
     * export needs these columns). Requires
     * supabase-migration-current-role.sql — NOT YET CONFIRMED RUN, same
     * deferred-column pattern as suggestedRoleFits/blacklisted above. Set by
     * app/api/screenings/regenerate-trajectories/route.ts (backfill) and, as
     * of 2026-08-06, saveScreening() itself for new screenings (see that
     * function's own comment for why it's a separate call, not folded into
     * the main insert).
     */
    currentCompany?: string;
    currentTitle?: string;
    /** Same deferred-column pattern as currentCompany above — see that field's comment and lib/types.ts's ScreeningRecord.totalExperienceSummary. */
    totalExperienceSummary?: string;
    /** Same deferred-column pattern as currentCompany above — see lib/types.ts's ScreeningRecord.linkedinUrl. Added 2026-08-06. */
    linkedinUrl?: string;
    /** Same deferred-column pattern as currentCompany above — see lib/types.ts's ScreeningRecord.targetCompanyMatches. Added 2026-08-07. */
    targetCompanyMatches?: string[];
    /**
     * JD checklist per-candidate result, 2026-08-17 (Vlad's ask). Same
     * deferred-column pattern as targetCompanyMatches above — requires
     * supabase-migration-checklist.sql, NOT YET CONFIRMED RUN. Written by
     * saveScreening()'s best-effort call only when the project had a
     * checklist configured (see that function's own comment). See
     * lib/types.ts's ChecklistEvaluation for shape.
     */
    checklistEvaluation?: ChecklistEvaluation;
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
  // current_company/current_title require supabase-migration-current-role.sql
  // — NOT YET CONFIRMED RUN. Same deferred-wiring pattern as archive_reason
  // above; only ever passed by the regenerate-trajectories backfill route.
  if (fields.currentCompany !== undefined) update.current_company = fields.currentCompany;
  if (fields.currentTitle !== undefined) update.current_title = fields.currentTitle;
  if (fields.totalExperienceSummary !== undefined) update.total_experience_summary = fields.totalExperienceSummary;
  if (fields.linkedinUrl !== undefined) update.linkedin_url = fields.linkedinUrl;
  if (fields.targetCompanyMatches !== undefined) update.target_company_matches = fields.targetCompanyMatches;
  // checklist_evaluation requires supabase-migration-checklist.sql — NOT YET
  // CONFIRMED RUN. Same deferred-wiring pattern as target_company_matches
  // above.
  if (fields.checklistEvaluation !== undefined) update.checklist_evaluation = fields.checklistEvaluation;
  if (fields.photoUrl !== undefined) update.photo_url = fields.photoUrl;
  if (fields.linkedInPdfPath !== undefined) update.linkedin_pdf_path = fields.linkedInPdfPath;
  // cross_ref_is_linkedin requires supabase-migration-cross-ref-doc-type.sql
  // — NOT YET CONFIRMED RUN. Written conditionally (only when the caller
  // passes it) same as archive_reason was before its migration was confirmed.
  if (fields.crossRefIsLinkedIn !== undefined) update.cross_ref_is_linkedin = fields.crossRefIsLinkedIn;
  // fraud_risk requires supabase-migration-fraud-calibration.sql — NOT YET
  // CONFIRMED RUN. Same deferred-wiring pattern as cross_ref_is_linkedin
  // above; every caller wraps this update in .catch(() => {}).
  if (fields.fraudRisk !== undefined) update.fraud_risk = fields.fraudRisk;
  if (fields.interviewQuestions !== undefined) update.interview_questions = fields.interviewQuestions;
  // archive_reason column not yet confirmed run (supabase-migration-archive-reason.sql)
  // — see that file's header for the sequencing rationale.
  if (fields.archiveReason !== undefined) update.archive_reason = fields.archiveReason;
  if (fields.linkedInMode !== undefined) update.linkedin_mode = fields.linkedInMode;
  // agency_name requires supabase-migration-agency-source.sql, confirmed run
  // (see decisions-log.md, 2026-07-20) — same column already wired into
  // saveScreening()'s INSERT unconditionally, so it's already a live column.
  if (fields.agencyName !== undefined) update.agency_name = fields.agencyName || null;
  if (fields.score !== undefined) update.score = fields.score;
  if (fields.mustHaveScore !== undefined) update.must_have_score = fields.mustHaveScore;
  if (fields.niceToHaveScore !== undefined) update.nice_to_have_score = fields.niceToHaveScore;
  if (fields.summary !== undefined) update.summary = fields.summary;
  if (fields.strengths !== undefined) update.strengths = fields.strengths;
  if (fields.concerns !== undefined) update.concerns = fields.concerns;
  if (fields.recommendation !== undefined) update.recommendation = fields.recommendation;
  if (fields.suggestedRoleFits !== undefined) update.suggested_role_fits = fields.suggestedRoleFits;
  // blacklisted/blacklist_reason require supabase-migration-blacklist.sql —
  // NOT YET CONFIRMED RUN. Same deferred-wiring pattern as suggested_role_fits
  // above.
  if (fields.blacklisted !== undefined) update.blacklisted = fields.blacklisted;
  if (fields.blacklistReason !== undefined) update.blacklist_reason = fields.blacklistReason;
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
    if (fields.fraudRisk !== undefined) {
      await logAction({ screeningId: id, userId: actorUserId, actionType: "fraud_risk_check" });
    }
    if (fields.score !== undefined) {
      await logAction({ screeningId: id, userId: actorUserId, actionType: "rescreen" });
    }
    if (fields.blacklisted !== undefined) {
      await logAction({
        screeningId: id,
        userId: actorUserId,
        actionType: fields.blacklisted ? "blacklisted" : "unblacklisted",
      });
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

export async function updateScreeningFraudRisk(
  id: number,
  fraudRisk: FraudRiskAssessment,
  actorUserId?: string
): Promise<void> {
  return updateScreening(id, { fraudRisk }, actorUserId);
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
