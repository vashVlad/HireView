import { NextRequest, NextResponse } from "next/server";
import { extractResumeText } from "@/lib/parseResume";
import { generateTrajectory } from "@/lib/generateTrajectory";
import { getScreeningResume, listScreenings, updateScreening } from "@/lib/screenings";
import { getAuthUser, isAdmin } from "@/lib/auth";

export const maxDuration = 60;

/**
 * Maintenance/backfill route, not called from any UI — found during the
 * 2026-07-16 full-codebase audit with NO auth check at all and no team
 * scoping (listScreenings() here is called without teamIds, which means
 * "admin, sees everything" per its own docstring, regardless of who's
 * actually calling). That combination meant any logged-in recruiter, on any
 * team, could trigger a system-wide bulk Claude-API operation touching every
 * candidate across every team, not just their own. Admin-gated to match
 * every other cross-team/bulk operation in the app (Analytics, FunnelView,
 * admin/teams, admin/users).
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
    return NextResponse.json({ updated: 0, errors: [] });
  }

  let updated = 0;
  const errors: string[] = [];

  for (const s of screenings) {
    try {
      const { data, fileName } = await getScreeningResume(s.id!);
      const resumeText = await extractResumeText(fileName, data);
      // Also backfills current_company/current_title, 2026-08-04 (Vlad's
      // ask) — same Claude call as the trajectory itself now returns both,
      // see lib/generateTrajectory.ts.
      const { careerTrajectory, currentCompany, currentTitle } = await generateTrajectory(s.jobDescription, resumeText);
      await updateScreening(s.id!, { careerTrajectory });
      updated++;
      // Separate, best-effort update — current_company/current_title need
      // supabase-migration-current-role.sql, which may not be run yet. A
      // single updateScreening() call batches every field into one SQL
      // UPDATE, so bundling these with careerTrajectory above would fail the
      // WHOLE write (including the trajectory itself) if the columns don't
      // exist. Split out so a pre-migration environment still gets the
      // trajectory refresh — it just silently skips the new columns until
      // the migration runs, instead of regressing this route's one existing job.
      try {
        await updateScreening(s.id!, { currentCompany, currentTitle });
      } catch {
        /* pre-migration or other non-fatal failure — trajectory update above already counted */
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${s.candidateName}: ${msg}`);
    }
  }

  return NextResponse.json({ updated, errors });
}
