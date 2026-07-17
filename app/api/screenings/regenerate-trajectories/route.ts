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
      const trajectory = await generateTrajectory(s.jobDescription, resumeText);
      await updateScreening(s.id!, { careerTrajectory: trajectory });
      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${s.candidateName}: ${msg}`);
    }
  }

  return NextResponse.json({ updated, errors });
}
