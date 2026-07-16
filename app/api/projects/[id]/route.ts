import { NextRequest, NextResponse } from "next/server";
import { deleteProject, getProject, updateProject } from "@/lib/projects";
import { getAuthUser, isAdmin } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
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

  // teamId reassignment is admin-only — matches every other team-membership
  // mutation (create/delete team, add/remove member), all gated the same
  // way on the admin Team page. Added 2026-07-15 for the drag-and-drop
  // Team/Projects UI; every other field on this route stays open to any
  // authenticated recruiter as before.
  if (body?.teamId !== undefined) {
    const user = await getAuthUser();
    if (!user || !isAdmin(user)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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
  try {
    await deleteProject(numId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Project DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete project" }, { status: 500 });
  }
}
