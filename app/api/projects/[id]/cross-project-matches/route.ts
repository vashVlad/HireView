import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { canAccessProject, getAuthUser } from "@/lib/auth";
import { findCrossProjectMatchesForProject } from "@/lib/screenings";

/**
 * Standing Pipeline badge — Vlad's ask, 2026-07-30: "Also screened in
 * [project] — Scored [score]", shown on every Pipeline card at all times,
 * not gated behind the on-demand Cross-Project Fit Suggestion flow (which
 * only ever fires for below-threshold/marginal candidates — see
 * ResultCard's eligibleForFitCheck). One batched, team-wide lookup per
 * Pipeline tab load, keyed by this project's own screening ids, so
 * PipelineTab can populate every card from a single fetch instead of one
 * round trip per candidate.
 *
 * No teamId on the project = nothing to scope the lookup against, so this
 * just returns an empty map rather than erroring — matches the
 * fail-closed convention used throughout this feature area.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessProject(user, numId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const project = await getProject(numId);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (project.teamId == null) return NextResponse.json({ matches: {} });

    const matches = await findCrossProjectMatchesForProject({ teamId: project.teamId, projectId: numId });
    return NextResponse.json({ matches: Object.fromEntries(matches) });
  } catch (err) {
    console.error("Cross-project matches GET error:", err);
    // Fails closed — a broken lookup just means the badge doesn't show,
    // never blocks the Pipeline tab itself from loading.
    return NextResponse.json({ matches: {} });
  }
}
