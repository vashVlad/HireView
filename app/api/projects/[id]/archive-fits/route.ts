import { NextRequest, NextResponse } from "next/server";
import { canAccessProject, getAuthUser } from "@/lib/auth";
import { listPendingArchiveFits } from "@/lib/archiveFits";

/**
 * Archive Fits, 2026-07-30 — the pending review queue for a project's
 * "Archive Fits" tab. The Pipeline page also uses this list's length to
 * decide whether to show that tab at all — Vlad's ask: hide it entirely
 * when there's nothing to review, not show it empty.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const projectId = parseInt(id, 10);
  if (isNaN(projectId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessProject(user, projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const candidates = await listPendingArchiveFits(projectId);
    return NextResponse.json({ candidates });
  } catch (err) {
    console.error("Archive fits GET error:", err);
    return NextResponse.json({ error: "Failed to fetch archive fits" }, { status: 500 });
  }
}
