import { NextRequest, NextResponse } from "next/server";
import { deleteProject, getProject, updateProject } from "@/lib/projects";
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
    return NextResponse.json({ project });
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
