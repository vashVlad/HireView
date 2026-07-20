/**
 * One-time backfill for the recruiter-attribution bug fixed 2026-07-20 (see
 * memory/session-log.md's "Real recruiter-attribution bug found and fixed"
 * entry, and memory/decisions-log.md for the full root-cause writeup).
 *
 * Before that fix, saveScreening() wrote screenings.user_id straight from
 * the `userId` param, which callers pass in via userIdFilter(user) — a
 * query-scoping helper that deliberately returns undefined for admin ("admin
 * sees everything, no filter needed"). Reusing that same undefined-for-admin
 * value as the actual attribution written to the row meant every screening
 * an admin ran themselves saved with user_id: null — invisible to
 * FunnelView's recruiter column and Pipeline's recruiter filter.
 *
 * The good news: screening_actions' "created" row for every screening has
 * ALWAYS carried the correct acting user (this part of saveScreening()
 * already re-resolved the true session user before this session's fix —
 * confirmed via git diff against commit 7014c65, the pre-fix state). That's
 * exactly why Vlad noticed the discrepancy in the first place ("it shows
 * under the activity on the result card") — the log was right, the
 * screenings column was not. This script closes that gap by copying the
 * user_id off each row's own "created" action back onto screenings.user_id.
 *
 * Deliberately NOT a full re-derivation of "who actually screened this" —
 * it trusts the existing screening_actions "created" row as ground truth,
 * same as the Activity timeline UI already does. A screening with no
 * "created" action at all (shouldn't happen post-2026-07-08 when action
 * logging was added, but older rows or logging failures are possible) is
 * left alone and reported as unrecoverable rather than guessed at.
 *
 * Run once, from a machine with real Supabase network access:
 *   npx tsx scripts/backfill-recruiter-attribution.ts
 *
 * Safe to re-run — the query only ever selects rows still missing a
 * user_id, so a second run is a no-op except for any rows that failed on
 * the first pass.
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

interface NullUserIdRow {
  id: number;
  candidate_name: string;
}

interface CreatedActionRow {
  user_id: string | null;
  created_at: string;
}

async function main() {
  const supabase = getSupabaseClient();

  const { data: rows, error } = await supabase
    .from("screenings")
    .select("id, candidate_name")
    .is("user_id", null)
    .returns<NullUserIdRow[]>();

  if (error) {
    console.error("Failed to query affected rows:", error);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log("No screenings with a null user_id — nothing to do.");
    return;
  }

  console.log(`Found ${rows.length} screening(s) with no user_id. Backfilling from screening_actions...\n`);

  let succeeded = 0;
  const unrecoverable: { id: number; candidateName: string; reason: string }[] = [];

  for (const row of rows) {
    try {
      // Earliest "created" action is ground truth for who actually ran this
      // screening — same source the Activity timeline UI already reads from.
      const { data: actions, error: actionsError } = await supabase
        .from("screening_actions")
        .select("user_id, created_at")
        .eq("screening_id", row.id)
        .eq("action_type", "created")
        .order("created_at", { ascending: true })
        .limit(1)
        .returns<CreatedActionRow[]>();
      if (actionsError) throw actionsError;

      const createdUserId = actions?.[0]?.user_id ?? null;
      if (!createdUserId) {
        unrecoverable.push({
          id: row.id,
          candidateName: row.candidate_name,
          reason: actions && actions.length > 0
            ? "\"created\" action exists but has no user_id either"
            : "no \"created\" action found in screening_actions",
        });
        console.log(`  SKIP  #${row.id}  ${row.candidate_name}  — no recoverable recruiter`);
        continue;
      }

      const { error: updateError } = await supabase
        .from("screenings")
        .update({ user_id: createdUserId })
        .eq("id", row.id);
      if (updateError) throw updateError;

      succeeded++;
      console.log(`  ok    #${row.id}  ${row.candidate_name}  -> ${createdUserId}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      unrecoverable.push({ id: row.id, candidateName: row.candidate_name, reason });
      console.log(`  FAIL  #${row.id}  ${row.candidate_name}  — ${reason}`);
    }
  }

  console.log(`\nDone. ${succeeded}/${rows.length} backfilled.`);
  if (unrecoverable.length > 0) {
    console.log(`${unrecoverable.length} row(s) could not be backfilled:`);
    for (const f of unrecoverable) console.log(`  #${f.id} ${f.candidateName}: ${f.reason}`);
    console.log("\nThese will keep showing no recruiter in FunnelView/Pipeline until resolved some other way (e.g. manually, if the recruiter is known by other means).");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("Backfill script crashed:", err);
    process.exit(1);
  }
);
