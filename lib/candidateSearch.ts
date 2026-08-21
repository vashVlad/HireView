import { getSupabaseClient } from "./supabase";
import { generateEmbedding } from "./embeddings";

/**
 * Global talent search, 2026-08-17 (roadmap 2.5.9). Search mechanics per the
 * 2026-08-15 design session: the query is embedded once, compared via
 * vector similarity against pre-built candidate embeddings (fast/cheap
 * regardless of pool size, no per-search AI scoring call). No LLM
 * explanation layer on top (Vlad's explicit call — cost/simplicity) —
 * results are ranked purely by vector similarity, with a cosmetic
 * literal-term-overlap highlight pass so the recruiter sees WHY a result
 * might be relevant even though that's not what actually ranked it.
 *
 * Deliberately not live-tested — the `match_screenings_by_embedding`
 * Postgres function this calls (supabase-migration-candidate-embeddings.sql)
 * has never run against a real database from this sandbox, same
 * network-access limitation as everything else built this session.
 */

export interface SearchResultRow {
  screeningId: number;
  similarity: number;
}

/**
 * Embeds the query text and runs it through the vector-similarity RPC.
 * Returns [] (not a throw) if embedding fails (no API key, network error) or
 * the RPC call fails (migration not run yet) — a broken search should
 * degrade to "no results," not crash the page it's called from.
 */
export async function searchCandidatesByText(
  query: string,
  options?: { teamIds?: number[]; projectId?: number; limit?: number }
): Promise<SearchResultRow[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  // "query" input_type, not "document" — this is the search-time side of
  // Voyage's asymmetric embedding pair, see lib/embeddings.ts's header
  // comment. Using "document" here would silently degrade match quality,
  // not error, so this is easy to get wrong without noticing — flagged
  // explicitly for whoever live-tests this.
  const queryEmbedding = await generateEmbedding(trimmed, "query");
  if (!queryEmbedding) return [];

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc("match_screenings_by_embedding", {
      query_embedding: queryEmbedding,
      match_count: options?.limit ?? 20,
      filter_team_ids: options?.teamIds ?? null,
      filter_project_id: options?.projectId ?? null,
    });
    if (error) throw error;
    return ((data ?? []) as { id: number; similarity: number }[]).map((row) => ({
      screeningId: row.id,
      similarity: row.similarity,
    }));
  } catch (err) {
    console.error("Candidate vector search failed (migration likely not run yet) — returning no results:", err);
    return [];
  }
}

// ── Cosmetic highlight pass ─────────────────────────────────────────────────
//
// Decoration only, not the ranking signal (see this file's header comment) —
// a real semantic match can legitimately show zero highlighted words if the
// candidate's text never uses the query's literal phrasing (e.g.
// "Kubernetes" vs. query "container orchestration"). Flagged and accepted in
// the 2026-08-15 design session as an expected, non-bug outcome.

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "had",
  "was", "were", "are", "not", "but", "you", "your", "their", "they", "them",
  "who", "what", "when", "where", "how", "into", "over", "under", "about",
  "years", "year", "experience", "experienced", "using", "used", "use",
  "with", "someone", "who", "has",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
  );
}

/**
 * Given the recruiter's search query and one candidate's summary/strengths/
 * concerns text, returns the query terms that literally appear somewhere in
 * that text — for a "matched on: kubernetes, migration" style UI chip.
 * Empty array is a valid, expected result (see header comment above).
 */
export function highlightQueryOverlap(query: string, candidateText: string): string[] {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return [];
  const candidateTokens = tokenize(candidateText);
  return [...queryTokens].filter((t) => candidateTokens.has(t));
}
