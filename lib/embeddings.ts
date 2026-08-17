/**
 * Global talent search, 2026-08-17 (roadmap 2.5.9, decided design from the
 * 2026-08-15 planning session — see memory/session-log.md's entry for the
 * full reasoning trail). Voyage AI is Anthropic's own recommended embeddings
 * partner (Claude itself doesn't generate embeddings) — this is the first
 * vector/embedding infrastructure anywhere in this codebase.
 *
 * Same treatment as every other AI-call-involving file built this session:
 * structurally correct against Voyage's documented REST API (confirmed via
 * live web search, not assumed — POST https://api.voyageai.com/v1/embeddings,
 * Bearer auth, {input, model, input_type} body), but NEVER actually executed
 * here — this sandbox has no network access to api.voyageai.com any more
 * than it does to api.github.com or *.supabase.co. Needs a real
 * VOYAGE_API_KEY (not yet in .env.example — add it once Vlad has an
 * account) and a live call before this is trusted in production.
 *
 * input_type matters for retrieval quality: Voyage's models are trained
 * asymmetrically for search — "document" when embedding candidate profiles
 * for storage, "query" when embedding what the recruiter typed to search
 * with. Using the wrong one on either side doesn't error, it just quietly
 * makes results worse — call sites must get this right.
 */

const VOYAGE_MODEL = "voyage-3.5";
// voyage-3.5's documented default output_dimension. Fixed (not passed
// explicitly) so a future default change on Voyage's side can't silently
// produce vectors the wrong width for the `vector(1024)` column in
// supabase-migration-candidate-embeddings.sql — if Voyage's default ever
// changes, the dimension check below will start returning null loudly
// (logged) rather than corrupting the column with mismatched-width writes.
const EMBEDDING_DIMENSION = 1024;

interface VoyageEmbeddingResponse {
  data?: { embedding: number[] }[];
}

/**
 * Best-effort — returns null on any failure (missing API key, network
 * error, unexpected response shape, wrong dimension) rather than throwing.
 * Same "never block the caller's real work" convention as every other
 * isolated external call in this codebase (fetchGithubCorroboration,
 * generateFingerprint's error handling, etc.) — a failed embedding just
 * means that candidate isn't searchable yet, not a failed screening.
 */
export async function generateEmbedding(
  text: string,
  inputType: "document" | "query"
): Promise<number[] | null> {
  if (!process.env.VOYAGE_API_KEY) {
    console.error("VOYAGE_API_KEY is not set — embedding skipped");
    return null;
  }
  const trimmed = (text ?? "").trim();
  if (trimmed.length === 0) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let res: Response;
    try {
      res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: trimmed,
          model: VOYAGE_MODEL,
          input_type: inputType,
          output_dimension: EMBEDDING_DIMENSION,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      console.error(`Voyage embeddings API returned ${res.status}: ${await res.text().catch(() => "")}`);
      return null;
    }
    const data = (await res.json()) as VoyageEmbeddingResponse;
    const embedding = data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSION) {
      console.error(`Voyage embeddings API returned an unexpected shape (length ${embedding?.length ?? "n/a"}, expected ${EMBEDDING_DIMENSION})`);
      return null;
    }
    return embedding;
  } catch (err) {
    console.error("Embedding generation failed:", err);
    return null;
  }
}

/**
 * What actually gets embedded for a candidate — concatenated summary +
 * strengths + concerns + careerTrajectory (all already generated/saved at
 * screening time), not just the one-sentence summary alone. Per the
 * 2026-08-15 design session: the summary alone is too thin to search well
 * against — a query like "led a Kubernetes migration" needs the strengths/
 * trajectory text to actually have a chance of surfacing it.
 *
 * Pure function, unit-tested (test_embedding_text.mjs) — the actual API
 * call above can't be tested here, but what text gets sent to it can be.
 */
export function buildCandidateEmbeddingText(params: {
  summary?: string;
  strengths?: string[];
  concerns?: string[];
  careerTrajectory?: string;
}): string {
  const parts = [
    params.summary,
    ...(params.strengths ?? []),
    ...(params.concerns ?? []),
    params.careerTrajectory,
  ].filter((p): p is string => Boolean(p && p.trim().length > 0));
  return parts.join("\n");
}
