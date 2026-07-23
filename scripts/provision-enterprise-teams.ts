/**
 * One-time provisioning script for the Brillio enterprise pilot: creates the
 * 5 geography teams (India, USA, UK, Romania, Mexico) and bulk-creates/
 * assigns recruiter accounts from a roster CSV, instead of an admin clicking
 * through the /admin/users UI 56 times by hand.
 *
 * Written 2026-07-23 as part of the enterprise-pilot readiness pass (see
 * memory/decisions-log.md, "Teams architecture for geographies").
 *
 * Reuses the exact same functions the admin UI itself calls
 * (lib/teams.ts's createTeam/addTeamMember, the same createUser call
 * app/api/admin/users/route.ts's POST makes) — this is not a separate,
 * parallel implementation of user/team creation, just a bulk driver over
 * the same real code path.
 *
 * ROSTER FORMAT — a CSV at the path given via --roster (default:
 * scripts/roster.csv, gitignored, not included in this repo — create your
 * own from Brillio's actual list before running), one row per recruiter,
 * no header row:
 *   email,geography
 *   jane.doe@brillio.com,India
 *   john.smith@brillio.com,USA
 *
 * geography must be one of: India, USA, UK, Romania, Mexico (case-sensitive
 * match against the team names this script creates — see GEOGRAPHIES below).
 *
 * Run once, from a machine with real Supabase network access:
 *   npx tsx scripts/provision-enterprise-teams.ts --roster scripts/roster.csv
 *
 * Safe to re-run: team creation checks for an existing team with the same
 * name first (same pattern as supabase-migration-teams.sql's "General" team
 * backfill); user creation is NOT idempotent by design (Supabase Auth's
 * createUser will error on a duplicate email, which this script reports as a
 * per-row failure and continues past) — re-running after a partial failure
 * will correctly skip existing users' auth-creation step failing loudly, but
 * will still attempt the team-membership add again (addTeamMember is
 * idempotent, see lib/teams.ts — duplicate membership is a no-op).
 *
 * DOES NOT set a real per-user temporary password — generates one
 * (Brillio2026!-prefixed + a short random suffix) per user, logged to
 * stdout at the end in a single roster-with-passwords table. Distribute
 * these to recruiters through whatever secure channel Brillio's rollout
 * plan calls for — this script does not email anyone.
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
import { createTeam, addTeamMember } from "../lib/teams";

const GEOGRAPHIES = ["India", "USA", "UK", "Romania", "Mexico"] as const;
type Geography = (typeof GEOGRAPHIES)[number];

interface RosterRow {
  email: string;
  geography: Geography;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function parseRoster(path: string): RosterRow[] {
  const contents = readFileSync(path, "utf-8");
  const rows: RosterRow[] = [];
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [emailRaw, geoRaw] = trimmed.split(",").map((s) => s.trim());
    if (!emailRaw || !geoRaw) continue;
    if (!GEOGRAPHIES.includes(geoRaw as Geography)) {
      throw new Error(
        `Invalid geography "${geoRaw}" for ${emailRaw} — must be one of: ${GEOGRAPHIES.join(", ")}`
      );
    }
    rows.push({ email: emailRaw, geography: geoRaw as Geography });
  }
  return rows;
}

async function ensureTeam(name: string, existingByName: Map<string, number>): Promise<number> {
  const existing = existingByName.get(name);
  if (existing != null) return existing;
  const team = await createTeam(name);
  existingByName.set(name, team.id);
  return team.id;
}

async function main() {
  const rosterArgIdx = process.argv.indexOf("--roster");
  const rosterPath = rosterArgIdx !== -1 ? process.argv[rosterArgIdx + 1] : join(__dirname, "roster.csv");

  let roster: RosterRow[];
  try {
    roster = parseRoster(rosterPath);
  } catch (err) {
    console.error(`Could not read/parse roster at ${rosterPath}:`, err instanceof Error ? err.message : err);
    console.error("See this script's header comment for the expected CSV format.");
    process.exit(1);
  }

  console.log(`Loaded ${roster.length} roster row(s) from ${rosterPath}.\n`);

  const supabase = getSupabaseClient();

  // Step 1 — create the 5 geography teams (idempotent).
  const { data: existingTeams } = await supabase.from("teams").select("id, name").returns<{ id: number; name: string }[]>();
  const teamIdByName = new Map((existingTeams ?? []).map((t) => [t.name, t.id]));

  for (const geo of GEOGRAPHIES) {
    const id = await ensureTeam(geo, teamIdByName);
    console.log(`Team "${geo}" → id ${id}${teamIdByName.has(geo) ? "" : " (created)"}`);
  }
  console.log();

  // Step 2 — create each recruiter and assign them to their team.
  const results: { email: string; geography: string; status: "created" | "skipped" | "failed"; password?: string; reason?: string }[] = [];

  for (const row of roster) {
    const teamId = teamIdByName.get(row.geography)!;
    const tempPassword = `Brillio2026!${randomSuffix()}`;

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: row.email,
      password: tempPassword,
      email_confirm: true,
      app_metadata: { role: "recruiter" },
    });

    if (createError) {
      // Most common cause: user already exists. Look them up so team
      // assignment can still proceed even though creation itself failed.
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existingUser = existingUsers?.users.find((u) => u.email === row.email);
      if (!existingUser) {
        results.push({ email: row.email, geography: row.geography, status: "failed", reason: createError.message });
        console.log(`  FAIL    ${row.email}  — ${createError.message}`);
        continue;
      }
      await addTeamMember(teamId, existingUser.id);
      results.push({ email: row.email, geography: row.geography, status: "skipped", reason: "user already existed — added to team, no new password" });
      console.log(`  SKIP    ${row.email}  — already existed, added to ${row.geography} team`);
      continue;
    }

    await addTeamMember(teamId, created.user.id);
    results.push({ email: row.email, geography: row.geography, status: "created", password: tempPassword });
    console.log(`  OK      ${row.email}  → ${row.geography}`);
  }

  console.log("\n--- Temporary passwords for newly created accounts (distribute securely) ---");
  console.log("email,geography,temp_password");
  for (const r of results) {
    if (r.status === "created") console.log(`${r.email},${r.geography},${r.password}`);
  }

  const createdCount = results.filter((r) => r.status === "created").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  console.log(`\nDone. ${createdCount} created, ${skippedCount} skipped (already existed), ${failedCount} failed.`);
  if (failedCount > 0) {
    console.log("Failed rows:");
    for (const r of results.filter((x) => x.status === "failed")) console.log(`  ${r.email}: ${r.reason}`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("Provisioning script crashed:", err);
    process.exit(1);
  }
);
