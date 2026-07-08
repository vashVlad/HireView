import { getSupabaseClient } from "./supabase";

/**
 * Saves aggregate stats for one screening run.
 * Called after all resumes in a batch are scored — before any threshold filtering.
 * This is the source of truth for analytics totals (including rejected candidates).
 */
export async function saveScreeningBatch(params: {
  userId?: string;
  projectId?: number;
  scores: number[];        // ALL scores, including below-threshold
  passedCount: number;     // how many met the threshold
}): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("screening_batches").insert({
    user_id: params.userId ?? null,
    project_id: params.projectId ?? null,
    total_count: params.scores.length,
    passed_count: params.passedCount,
    scores: params.scores,
  });
  if (error) throw new Error(`saveScreeningBatch: ${error.message}`);
}
