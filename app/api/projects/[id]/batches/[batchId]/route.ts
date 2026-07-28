import { NextRequest, NextResponse } from "next/server";
import { listScreeningsByBatch } from "@/lib/screenings";
import { canAccessProject, getAuthUser } from "@/lib/auth";

/**
 * Backs the durable /projects/[id]/batches/[batchId] page — Vlad's ask,
 * 2026-07-28. Same auth pattern as app/api/projects/[id]/route.ts
 * (canAccessProject, not just "logged in") since a batch's screenings carry
 * the same team-scoped candidate data any other by-id route protects.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; batchId: string }> }
) {
  const { id, batchId } = await params;
  const projectId = parseInt(id, 10);
  if (isNaN(projectId) || !batchId) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessProject(user, projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const screenings = await listScreeningsByBatch(projectId, batchId);
    return NextResponse.json({ screenings });
  } catch (err) {
    console.error("Batch results GET error:", err);
    return NextResponse.json({ error: "Failed to fetch this batch" }, { status: 500 });
  }
}
