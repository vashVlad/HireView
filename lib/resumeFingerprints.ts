import { getSupabaseClient } from "./supabase";
import { compareFingerprints, isDuplicateMatch, type ResumeFingerprint } from "./generateFingerprint";

interface FingerprintRow {
  screening_id: number;
  skills_hash: string;
  responsibility_vectors: string[];
  metric_claims: string[];
  career_arc_signature: string;
}

export interface DuplicateMatch {
  screeningId: number;
  similarity: number;
}

export async function saveFingerprint(params: {
  screeningId: number;
  projectId?: number;
  teamId?: number | null;
  fingerprint: ResumeFingerprint;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("resume_fingerprints").insert({
    screening_id: params.screeningId,
    project_id: params.projectId ?? null,
    team_id: params.teamId ?? null,
    skills_hash: params.fingerprint.skillsHash,
    responsibility_vectors: params.fingerprint.responsibilityVectors,
    metric_claims: params.fingerprint.metricClaims,
    career_arc_signature: params.fingerprint.careerArcSignature,
  });
  if (error) throw error;
}

/**
 * Finds the closest duplicate match for a fingerprint, scoped to a project
 * (v1.1 matches within the same project — cross-project matching is Feature
 * 1.4, once Teams (1.3) defines what "same team" means for isolation).
 */
export async function findDuplicateMatch(params: {
  projectId?: number;
  excludeScreeningId?: number;
  fingerprint: ResumeFingerprint;
}): Promise<DuplicateMatch | null> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("resume_fingerprints")
    .select("screening_id, skills_hash, responsibility_vectors, metric_claims, career_arc_signature");
  if (params.projectId != null) query = query.eq("project_id", params.projectId);

  const { data, error } = await query.returns<FingerprintRow[]>();
  if (error) throw error;
  if (!data || data.length === 0) return null;

  let best: DuplicateMatch | null = null;
  for (const row of data) {
    if (params.excludeScreeningId != null && row.screening_id === params.excludeScreeningId) continue;

    const candidate: ResumeFingerprint = {
      skillsHash: row.skills_hash,
      responsibilityVectors: row.responsibility_vectors,
      metricClaims: row.metric_claims,
      careerArcSignature: row.career_arc_signature,
    };
    const similarity = compareFingerprints(params.fingerprint, candidate);
    if (isDuplicateMatch(similarity) && (!best || similarity > best.similarity)) {
      best = { screeningId: row.screening_id, similarity };
    }
  }
  return best;
}

/** Flags both sides of a duplicate pair so either card shows the badge and links to the other. */
export async function markDuplicatePair(idA: number, idB: number): Promise<void> {
  const supabase = getSupabaseClient();
  const [resA, resB] = await Promise.all([
    supabase.from("screenings").update({ duplicate_flag: true, duplicate_match_id: idB }).eq("id", idA),
    supabase.from("screenings").update({ duplicate_flag: true, duplicate_match_id: idA }).eq("id", idB),
  ]);
  if (resA.error) throw resA.error;
  if (resB.error) throw resB.error;
}

// ── Candidate History Alert (Phase 1.4) ──────────────────────────────────────
//
// Extends matching across projects within the same team (the boundary Phase
// 1.3 defines) — same-project matching above is untouched. A cross-project
// match produces one of two banners, never a bare "duplicate" claim: this is
// resubmission detection, not automatically an accusation of fraud.

export interface CrossProjectMatch {
  screeningId: number;
  projectId: number | null;
  similarity: number;
}

/**
 * Finds the closest fingerprint match within the same team, excluding the
 * candidate's own project (that case is already covered by findDuplicateMatch
 * above) and its own screening.
 */
export async function findCrossProjectMatch(params: {
  teamId: number;
  excludeProjectId?: number;
  excludeScreeningId?: number;
  fingerprint: ResumeFingerprint;
}): Promise<CrossProjectMatch | null> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("resume_fingerprints")
    .select("screening_id, project_id, skills_hash, responsibility_vectors, metric_claims, career_arc_signature")
    .eq("team_id", params.teamId);
  if (params.excludeProjectId != null) query = query.neq("project_id", params.excludeProjectId);

  const { data, error } = await query.returns<(FingerprintRow & { project_id: number | null })[]>();
  if (error) throw error;
  if (!data || data.length === 0) return null;

  let best: CrossProjectMatch | null = null;
  for (const row of data) {
    if (params.excludeScreeningId != null && row.screening_id === params.excludeScreeningId) continue;

    const candidate: ResumeFingerprint = {
      skillsHash: row.skills_hash,
      responsibilityVectors: row.responsibility_vectors,
      metricClaims: row.metric_claims,
      careerArcSignature: row.career_arc_signature,
    };
    const similarity = compareFingerprints(params.fingerprint, candidate);
    if (isDuplicateMatch(similarity) && (!best || similarity > best.similarity)) {
      best = { screeningId: row.screening_id, projectId: row.project_id, similarity };
    }
  }
  return best;
}

/**
 * Sets the history alert on both sides of a cross-project match. alertType is
 * computed by the caller (saveScreening) from the escalation rule: known_fraud_pattern
 * if either side already carries a same-project duplicate_flag or was already
 * known_fraud_pattern itself; previously_seen otherwise.
 */
export async function markHistoryAlertPair(
  idA: number,
  idB: number,
  alertType: "previously_seen" | "known_fraud_pattern"
): Promise<void> {
  const supabase = getSupabaseClient();
  const [resA, resB] = await Promise.all([
    supabase.from("screenings").update({ history_alert_type: alertType, history_alert_match_id: idB }).eq("id", idA),
    supabase.from("screenings").update({ history_alert_type: alertType, history_alert_match_id: idA }).eq("id", idB),
  ]);
  if (resA.error) throw resA.error;
  if (resB.error) throw resB.error;
}

/** Reads the flags needed to decide escalation for a matched screening. */
export async function getScreeningFraudSignals(
  screeningId: number
): Promise<{ duplicateFlag: boolean; historyAlertType: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("screenings")
    .select("duplicate_flag, history_alert_type")
    .eq("id", screeningId)
    .maybeSingle<{ duplicate_flag: boolean; history_alert_type: string | null }>();
  if (error) throw error;
  return { duplicateFlag: data?.duplicate_flag ?? false, historyAlertType: data?.history_alert_type ?? null };
}
