/**
 * One-time backfill for the "transferred candidates don't merge" bug fixed
 * 2026-07-30 (see memory/session-log.md). Before that fix,
 * transferScreeningToProject() never linked a transfer's source and
 * destination screenings via historyAlertMatchId/historyAlertType — the
 * only field lib/matchClusters.ts's computeMatchClusters() unions on that's
 * capable of a cross-project edge. Every transfer made before that fix
 * shipped left its pair of screenings looking like two unrelated
 * candidates, with no "Multiple roles" merged-card treatment.
 *
 * transferScreeningToProject() already writes transferred_to_screening_id
 * on the source row for every transfer (regardless of mode), so this script
 * doesn't need to guess which screenings were ever paired — it just
 * replays the same guarded linking logic the live code now runs, for every
 * row that has that pointer set but never got the historyAlertMatchId edge.
 *
 * Same known_fraud_pattern guard as the live fix: never downgrades a
 * genuine fraud-pattern link on either side to a benign "previously_seen".
 *
 * Run once, from a machine with real Supabase network access:
 *   npx tsx scripts/backfill-transfer-history-links.ts
 *
 * Safe to re-run — a row that already has a historyAlertMatchId set is
 * skipped, so a second run only touches whatever a first run missed.
 */

import { readFileSync } from "fs";
import { join } from "path";

// Minimal .env.local loader — see scripts/backfill-resume-hashes.ts for why
// this exists (no dotenv dependency, this runs outside Next's own loading).
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
import { markHistoryAlertPair, getScreeningFraudSignals } from "../lib/resumeFingerprints";

interface TransferredRow {
  id: number;
  candidate_name: string;
  transferred_to_screening_id: number | null;
  history_alert_match_id: number | null;
}

async function main() {
  const supabase = getSupabaseClient();

  const { data: rows, error } = await supabase
    .from("screenings")
    .select("id, candidate_name, transferred_to_screening_id, history_alert_match_id")
    .not("transferred_to_screening_id", "is", null)
    .returns<TransferredRow[]>();

  if (error) {
    console.error("Failed to query transferred screenings:", error);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log("No transferred screenings found — nothing to do.");
    return;
  }

  const toLink = rows.filter((r) => r.history_alert_match_id == null);
  console.log(`Found ${rows.length} transferred screening(s), ${toLink.length} not yet linked. Backfilling...\n`);

  if (toLink.length === 0) {
    console.log("Every transferred screening already has a historyAlertMatchId — nothing to do.");
    return;
  }

  let linked = 0;
  let skipped = 0;
  const failed: { id: number; candidateName: string; reason: string }[] = [];

  for (const row of toLink) {
    const destinationId = row.transferred_to_screening_id!;
    try {
      const [sourceSignals, destSignals] = await Promise.all([
        getScreeningFraudSignals(row.id),
        getScreeningFraudSignals(destinationId),
      ]);
      if (sourceSignals.historyAlertType === "known_fraud_pattern" || destSignals.historyAlertType === "known_fraud_pattern") {
        skipped++;
        console.log(`  skip  #${row.id}  ${row.candidate_name}  — already carries a known_fraud_pattern link, not overwriting`);
        continue;
      }
      await markHistoryAlertPair(row.id, destinationId, "previously_seen");
      linked++;
      console.log(`  ok    #${row.id}  ${row.candidate_name}  -> #${destinationId}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ id: row.id, candidateName: row.candidate_name, reason });
      console.log(`  FAIL  #${row.id}  ${row.candidate_name}  — ${reason}`);
    }
  }

  console.log(`\nDone. ${linked} linked, ${skipped} skipped (fraud guard), ${failed.length} failed.`);
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
