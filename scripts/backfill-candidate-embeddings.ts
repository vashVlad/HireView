/**
 * One-time backfill for the `embedding` column added by
 * supabase-migration-candidate-embeddings.sql (roadmap 2.5.9, global talent
 * search). Every screening saved BEFORE that migration ran (all ~397
 * candidates as of the 2026-08-15 design session, per session-log.md) has
 * embedding: null and won't show up in search results until backfilled —
 * new screenings get their embedding written automatically going forward
 * (see app/api/screen-resumes/route.ts's 2026-08-17 do-not-touch exception).
 *
 * Mirrors scripts/backfill-resume-hashes.ts's structure exactly (same
 * .env.local loader, same per-row try/catch-and-report shape) — see that
 * script's own header comment for why a hand-rolled env loader exists here
 * instead of a dependency.
 *
 * Costs real Voyage API calls (one embedding request per screening still
 * missing one) — cheap per Voyage's pricing, but not free; this is why it's
 * a deliberate one-time script run by a human, not something that fires
 * automatically. Requires VOYAGE_API_KEY to be set.
 *
 * Run once, from a machine with real Supabase + Voyage network access:
 *   npx tsx scripts/backfill-candidate-embeddings.ts
 *
 * Safe to re-run — only ever selects rows still missing an embedding.
 *
 * Paced at one request per ~21s (see PACE_MS below) to stay under Voyage's
 * unauthenticated-tier rate limit (confirmed live, 2026-08-17: 3 req/min
 * without a payment method on file) — for ~400 rows that's roughly 2-2.5
 * hours end to end, not a quick script. Intended to run unattended in the
 * background; check the final summary line for the success count when done.
 * Once a payment method is added to the Voyage account, PACE_MS can be
 * lowered significantly — this value is calibrated to the free tier, not a
 * permanent constraint.
 */

import { readFileSync } from "fs";
import { join } from "path";

function loadEnvLocal() {
  const path = join(__dirname, "..", ".env.local");
  let contents: string;
  try {
    contents = readFileSync(path, "utf-8");
  } catch {
    return;
  }
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvLocal();

import { getSupabaseClient } from "../lib/supabase";
import { setScreeningEmbedding } from "../lib/screenings";
import { generateEmbedding, buildCandidateEmbeddingText } from "../lib/embeddings";

interface MissingEmbeddingRow {
  id: number;
  candidate_name: string;
  summary: string | null;
  strengths: string[] | null;
  concerns: string[] | null;
  career_trajectory: string | null;
}

async function main() {
  if (!process.env.VOYAGE_API_KEY) {
    console.error("VOYAGE_API_KEY is not set — cannot generate embeddings. Add it to .env.local first.");
    process.exit(1);
  }

  const supabase = getSupabaseClient();

  const { data: rows, error } = await supabase
    .from("screenings")
    .select("id, candidate_name, summary, strengths, concerns, career_trajectory")
    .is("embedding", null)
    .returns<MissingEmbeddingRow[]>();

  if (error) {
    console.error("Failed to query affected rows (is supabase-migration-candidate-embeddings.sql run yet?):", error);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log("No screenings with a null embedding — nothing to do.");
    return;
  }

  console.log(`Found ${rows.length} screening(s) with no embedding. Backfilling...\n`);

  let succeeded = 0;
  let skipped = 0;
  const failed: { id: number; candidateName: string; reason: string }[] = [];

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Real bug found and fixed 2026-08-17, live-verified against the actual
  // Voyage account: without a payment method on file, Voyage caps
  // unauthenticated-tier accounts at 3 requests/minute (confirmed via a
  // real 429 response, not assumed). This loop originally fired requests
  // back-to-back with zero pacing or retry — against a real ~400-row batch
  // that means the first 3 succeed and essentially everything after
  // permanently fails within the same run, since generateEmbedding()
  // itself has no retry logic (by design — it's meant to degrade to null
  // for a single screening's best-effort write, not for a batch script that
  // needs to actually finish). A batch script calling it hundreds of times
  // in a row needs its own pacing/retry layer on top, which is what this
  // is. PACE_MS keeps steady-state calls comfortably under 3/min; the retry
  // loop below is the safety net for whenever that's not enough (a burst
  // from elsewhere hitting the same key, a transient network blip, etc.).
  const PACE_MS = 21_000;
  const MAX_ATTEMPTS = 3;

  for (const row of rows) {
    try {
      const text = buildCandidateEmbeddingText({
        summary: row.summary ?? undefined,
        strengths: row.strengths ?? undefined,
        concerns: row.concerns ?? undefined,
        careerTrajectory: row.career_trajectory ?? undefined,
      });
      if (!text) {
        skipped++;
        console.log(`  skip  #${row.id}  ${row.candidate_name}  — no summary/strengths/concerns/trajectory text to embed`);
        continue;
      }

      let embedding: number[] | null = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        embedding = await generateEmbedding(text, "document");
        if (embedding) break;
        if (attempt < MAX_ATTEMPTS) {
          const backoffMs = 30_000 * attempt; // 30s, then 60s
          console.log(`  retry #${row.id}  ${row.candidate_name}  — attempt ${attempt} failed, waiting ${backoffMs / 1000}s`);
          await sleep(backoffMs);
        }
      }
      if (!embedding) {
        throw new Error("generateEmbedding returned null after retries — check Voyage API key/quota/response shape");
      }

      await setScreeningEmbedding(row.id, embedding);
      succeeded++;
      console.log(`  ok    #${row.id}  ${row.candidate_name}`);
      await sleep(PACE_MS);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ id: row.id, candidateName: row.candidate_name, reason });
      console.log(`  FAIL  #${row.id}  ${row.candidate_name}  — ${reason}`);
    }
  }

  console.log(`\nDone. ${succeeded}/${rows.length} backfilled, ${skipped} skipped (no text), ${failed.length} failed.`);
  if (failed.length > 0) {
    console.log("Failed rows:");
    for (const f of failed) console.log(`  #${f.id} ${f.candidateName}: ${f.reason}`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("Backfill script crashed:", err);
    process.exit(1);
  }
);
