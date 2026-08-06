import { NextRequest, NextResponse } from "next/server";
import { extractResumeText } from "@/lib/parseResume";
import { generateTrajectory } from "@/lib/generateTrajectory";
import { getCurrentRoleStatus, getScreeningResume, listScreenings, updateScreening } from "@/lib/screenings";
import { getAuthUser, isAdmin } from "@/lib/auth";

export const maxDuration = 60;

/**
 * Maintenance/backfill route — originally not called from any UI (found
 * during the 2026-07-16 audit with no auth check at all), now wired to a
 * "Regenerate trajectories" button in a project's Settings tab. Admin-gated
 * to match every other cross-team/bulk operation in the app.
 *
 * Scope narrowed 2026-08-04 (Vlad's ask: "only do the candidates who don't
 * have those two yet") — this now ONLY processes screenings missing
 * current_company or current_title (via getCurrentRoleStatus), skipping
 * everyone already backfilled. Makes it safe/cheap to click repeatedly as a
 * role gets new candidates, instead of re-running a Claude call (and
 * re-writing careerTrajectory) for every candidate in the role every time.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const projectId: number | undefined =
    typeof body?.projectId === "number" ? body.projectId : undefined;

  let screenings;
  try {
    screenings = await listScreenings(undefined, undefined, undefined, projectId);
  } catch (err) {
    console.error("Failed to list screenings:", err);
    return NextResponse.json({ error: "Failed to fetch screenings" }, { status: 500 });
  }

  if (screenings.length === 0) {
    return NextResponse.json({ updated: 0, skipped: 0, errors: [] });
  }

  const statusById = await getCurrentRoleStatus(screenings.map((s) => s.id!));
  const pending = screenings.filter((s) => {
    const status = statusById.get(s.id!);
    return !status || !status.currentCompany || !status.currentTitle;
  });
  const skipped = screenings.length - pending.length;

  if (pending.length === 0) {
    return NextResponse.json({ updated: 0, skipped, errors: [] });
  }

  let updated = 0;
  const errors: string[] = [];

  for (const s of pending) {
    try {
      const { data, fileName } = await getScreeningResume(s.id!);
      const resumeText = await extractResumeText(fileName, data);
      const { careerTrajectory, currentCompany, currentTitle, totalExperienceSummary } = await generateTrajectory(s.jobDescription, resumeText);
      await updateScreening(s.id!, { careerTrajectory });
      updated++;
      // Separate, best-effort update — current_company/current_title/
      // total_experience_summary all need supabase-migration-current-role.sql,
      // which may not be run yet. A single updateScreening() call batches
      // every field into one SQL UPDATE, so bundling these with
      // careerTrajectory above would fail the WHOLE write (including the
      // trajectory itself) if the columns don't exist. Split out so a
      // pre-migration environment still gets the trajectory refresh — it
      // just silently skips the new columns until the migration runs.
      try {
        await updateScreening(s.id!, { currentCompany, currentTitle, totalExperienceSummary });
      } catch {
        /* pre-migration or other non-fatal failure — trajectory update above already counted */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${s.candidateName}: ${msg}`);
    }
  }

  return NextResponse.json({ updated, skipped, errors });
}
