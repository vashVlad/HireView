import { NextRequest, NextResponse } from "next/server";
import { getScreeningsByIds, findCandidateInProject } from "@/lib/screenings";
import { getProject } from "@/lib/projects";
import { canAccessScreening, canAccessProject, getAuthUser } from "@/lib/auth";
import { errorMessage } from "@/lib/errorMessage";

/**
 * Step 1 of the redesigned Transfer flow (Vlad's ask, 2026-07-29, after
 * testing the original dropdown-driven version and finding it always
 * blindly copied the score over). Called the moment a recruiter picks a
 * destination project in TransferControl's popover, BEFORE deciding
 * whether to re-score — cheap, no Claude call, just a name-match lookup
 * (findCandidateInProject) scoped to the one project they picked.
 *
 * If the candidate already has a screening there, the popover shows that
 * existing score directly and skips the re-score option entirely (nothing
 * to re-screen — see /transfer/route.ts's "existing" mode, which just
 * points the original at that row instead of creating a duplicate).
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
    const [screening] = await getScreeningsByIds([screeningId]);
    if (!screening) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const destinationProject = await getProject(destinationProjectId);
    if (!destinationProject) return NextResponse.json({ error: "Destination project not found" }, { status: 404 });

    const existing = await findCandidateInProject(screening.candidateName, destinationProjectId);
    return NextResponse.json({
      existing: existing ? { screeningId: existing.screeningId, score: existing.score } : null,
    });
  } catch (err) {
    console.error("Transfer precheck failed:", err);
    // See lib/errorMessage.ts — surfaces the real Supabase/etc. error
    // message instead of a fixed generic string.
    return NextResponse.json({ error: errorMessage(err, "Precheck failed") }, { status: 500 });
  }
}
