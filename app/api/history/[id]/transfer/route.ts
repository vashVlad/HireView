import { NextRequest, NextResponse } from "next/server";
import { transferScreeningToProject } from "@/lib/screenings";
import { canAccessScreening, canAccessProject, getAuthUser } from "@/lib/auth";

/**
 * Transfer status action — Vlad's ask, 2026-07-29: "add an option to
 * transfer the candidate to another project from the status dropdown."
 * Deliberately a dedicated route, not folded into the generic PATCH
 * /api/history/[id] (which only ever flips a plain field) — a transfer
 * does real work: re-reads the original resume from storage, creates a
 * genuinely new, separately-scored screening in the destination project,
 * and only then marks the original as "transferred" pointing at it. See
 * transferScreeningToProject() in lib/screenings.ts for the full design
 * rationale.
 *
 * Two access checks, matching Vlad's confirmed scoping: canAccessScreening
 * for the SOURCE (same as every other by-id history route) and
 * canAccessProject for the DESTINATION — a recruiter can only transfer into
 * a project their own team owns; an admin can transfer into any project
 * (canAccessProject already resolves that way, see lib/auth.ts). The
 * destination project list a recruiter/admin sees client-side (GET
 * /api/projects, same teamIdsFilter scoping) should already only offer
 * valid choices, but this never trusts that alone — same "never trust a
 * client-supplied id" precedent as every other cross-project route this
 * session.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const screeningId = parseInt(id, 10);
  if (isNaN(screeningId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const destinationProjectId = typeof body?.projectId === "number" ? body.projectId : NaN;
  if (isNaN(destinationProjectId)) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessScreening(user, screeningId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await canAccessProject(user, destinationProjectId))) {
    return NextResponse.json({ error: "Forbidden — you don't have access to that project" }, { status: 403 });
  }

  try {
    const { newScreeningId, destinationProjectName } = await transferScreeningToProject({
      screeningId,
      destinationProjectId,
      actingUserId: user.id,
    });
    return NextResponse.json({
      newScreeningId,
      transferredToProjectId: destinationProjectId,
      transferredToProjectName: destinationProjectName,
    });
  } catch (err) {
    console.error("Transfer failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Transfer failed" }, { status: 500 });
  }
}
