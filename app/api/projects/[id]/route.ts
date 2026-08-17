import { NextRequest, NextResponse } from "next/server";
import { deleteProject, getProject, getProjectChecklist, getProjectFitExclusion, updateProject } from "@/lib/projects";
import { canAccessProject, getAuthUser, isAdmin } from "@/lib/auth";

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
    // Isolated read, merged on — see getProjectFitExclusion's own comment
    // for why this is kept out of getProject()'s shared select.
    const excludeFromFitSuggestions = await getProjectFitExclusion(numId);
    // Checklist, 2026-08-17 — same isolated-read-merged-on pattern as
    // excludeFromFitSuggestions above, and same reason (kept out of
    // getProject()'s shared select — see lib/projects.ts's
    // getProjectChecklist comment). Unlike excludeFromFitSuggestions this
    // does NOT fail closed to a safe default — a genuine read error here
    // surfaces as this whole GET failing (caught below), since the Filters
    // tab needs to know the difference between "no checklist configured
    // yet" (null) and "couldn't load the checklist" (error).
    const checklist = await getProjectChecklist(numId);
    return NextResponse.json({ project: { ...project, excludeFromFitSuggestions, checklist } });
  } catch (err) {
    console.error("Project GET error:", err);
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const body = await request.json().catch(() => null);

  // General team-membership check, added in the 2026-07-16 audit — this
  // route previously let any authenticated user (any team) edit any
  // project's name/JD/status/threshold, since only the teamId field itself
  // had a gate. Every PATCH now requires the caller to actually own this
  // project (own team, or admin).
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessProject(user, numId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // teamId reassignment is additionally admin-only — matches every other
  // team-membership mutation (create/delete team, add/remove member), all
  // gated the same way on the admin Team page. Added 2026-07-15 for the
  // drag-and-drop Team/Projects UI.
  if (body?.teamId !== undefined && !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await updateProject(numId, {
      ...(body?.name !== undefined && { name: body.name }),
      ...(body?.jobDescription !== undefined && { jobDescription: body.jobDescription }),
      ...(body?.jdAnalysis !== undefined && { jdAnalysis: body.jdAnalysis }),
      ...(body?.status !== undefined && { status: body.status }),
      ...(body?.scoreThreshold !== undefined && { scoreThreshold: Number(body.scoreThreshold) }),
      ...(body?.teamId !== undefined && { teamId: body.teamId === null ? null : Number(body.teamId) }),
      ...(body?.excludeFromFitSuggestions !== undefined && { excludeFromFitSuggestions: Boolean(body.excludeFromFitSuggestions) }),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Project PATCH error:", err);
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(
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
    await deleteProject(numId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Project DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
