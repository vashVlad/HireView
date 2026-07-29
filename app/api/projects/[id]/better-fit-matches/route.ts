import { NextRequest, NextResponse } from "next/server";
import { findBetterFitMatches } from "@/lib/screenings";
import { getProject } from "@/lib/projects";
import { canAccessProject, getAuthUser } from "@/lib/auth";

/**
 * Backs the "Moved to [Project]" Pipeline badge — Vlad's ask, 2026-07-29:
 * "add one thing to the not opened result card on the pipeline, saying
 * that this candidate was moved to a different project ... only if the
 * candidate scored better on the other project." See
 * findBetterFitMatches()'s own comment in lib/screenings.ts for why this is
 * computed live on every Pipeline load rather than via a persisted column.
 * Same auth pattern as every other by-id route (canAccessProject).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const projectId = parseInt(id, 10);
  if (isNaN(projectId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessProject(user, projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const project = await getProject(projectId).catch(() => null);
    if (!project?.teamId) {
      // No team scope to compare against (e.g. a screening with no team) —
      // nothing to find, not an error.
      return NextResponse.json({ matches: {} });
    }
    const matches = await findBetterFitMatches(projectId, project.teamId);
    return NextResponse.json({ matches: Object.fromEntries(matches) });
  } catch (err) {
    console.error("Better-fit matches GET error:", err);
    return NextResponse.json({ error: "Failed to check for better-fit matches" }, { status: 500 });
  }
}
