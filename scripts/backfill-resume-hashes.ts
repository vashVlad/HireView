/**
 * One-time backfill for the resume_content_hash bug fixed 2026-07-17 (see
 * memory/session-log.md's "Real bug found + fixed: silent resume_content_hash
 * write failure" entry). Before that fix, resume_content_hash could silently
 * fail to be written whenever generateFingerprint()'s Claude call failed,
 * because both lived in the same try/catch. Any screening saved during one
 * of those failures has resume_content_hash: null and will never be caught
 * by the free exact-match duplicate pre-check (app/api/screen-resumes/
 * check-existing) again, no matter how many times the identical file is
 * re-uploaded.
 *
 * Confirmed scope, 2026-07-17: 66 of 124 screenings (~53%) currently have a
 * null resume_content_hash.
 *
 * This script re-extracts text from each affected screening's already-stored
 * resume file (no re-upload needed) and writes the hash. Deliberately does
 * NOT touch fingerprinting, duplicate_flag, or any other field — narrowly
 * scoped to the one thing that's actually missing. No Claude calls, so no
 * API cost and nothing that can rate-limit or time out the way the original
 * bug did.
 *
 * Run once, from a machine with real Supabase network access:
 *   npx tsx scripts/backfill-resume-hashes.ts
 *
 * Safe to re-run — the query only ever selects rows still missing a hash, so
 * a second run is a no-op except for any rows that failed on the first pass.
 */

import { readFileSync } from "fs";
import { join } from "path";

// Minimal .env.local loader — no dotenv dependency in this project, and this
// script runs outside Next's own env-loading, so it has to do this itself.
// Only sets a var if it isn't already present in the environment (lets a
// real shell-exported value win, same convention dotenv itself follows).
function loadEnvLocal() {
  const path = join(__dirname, "..", ".env.local");
  let contents: string;
  try {
    contents = readFileSync(path, "utf-8");
  } catch {
    return; // no .env.local — assume the caller already exported vars
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
import { getScreeningResume } from "../lib/screenings";
import { extractResumeText } from "../lib/parseResume";
import { hashResumeText } from "../lib/resumeContentHash";

interface NullHashRow {
  id: number;
  candidate_name: string;
}

async function main() {
  const supabase = getSupabaseClient();

  const { data: rows, error } = await supabase
    .from("screenings")
    .select("id, candidate_name")
    .is("resume_content_hash", null)
    .returns<NullHashRow[]>();

  if (error) {
    console.error("Failed to query affected rows:", error);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log("No screenings with a null resume_content_hash — nothing to do.");
    return;
  }

  console.log(`Found ${rows.length} screening(s) with no resume_content_hash. Backfilling...\n`);

  let succeeded = 0;
  const failed: { id: number; candidateName: string; reason: string }[] = [];

  for (const row of rows) {
    try {
      const { data, fileName } = await getScreeningResume(row.id);
      const text = await extractResumeText(fileName, data);
      const hash = hashResumeText(text);

      const { error: updateError } = await supabase
        .from("screenings")
        .update({ resume_content_hash: hash })
        .eq("id", row.id);
      if (updateError) throw updateError;

      succeeded++;
      console.log(`  ok    #${row.id}  ${row.candidate_name}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ id: row.id, candidateName: row.candidate_name, reason });
      console.log(`  FAIL  #${row.id}  ${row.candidate_name}  — ${reason}`);
    }
  }

  console.log(`\nDone. ${succeeded}/${rows.length} backfilled.`);
  if (failed.length > 0) {
    console.log(`${failed.length} row(s) could not be backfilled (resume file likely missing/corrupted in storage):`);
    for (const f of failed) console.log(`  #${f.id} ${f.candidateName}: ${f.reason}`);
    console.log("\nThese will keep re-triggering the same gap until their resume file issue is fixed separately.");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("Backfill script crashed:", err);
    process.exit(1);
  }
);
