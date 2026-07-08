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
  fingerprint: ResumeFingerprint;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("resume_fingerprints").insert({
    screening_id: params.screeningId,
    project_id: params.projectId ?? null,
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
