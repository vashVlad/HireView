import { NextRequest, NextResponse } from "next/server";
import { canAccessProject, getAuthUser } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { getScreeningResume, transferScreeningToProject } from "@/lib/screenings";
import { extractResumeText } from "@/lib/parseResume";
import { scoreCandidate } from "@/lib/scoreCandidate";
import { decideArchiveFit, getArchiveFitRow } from "@/lib/archiveFits";

export const maxDuration = 30;

/**
 * Archive Fits, 2026-07-30 — a recruiter's decision on one queued match.
 * 'skip' leaves the original archived screening exactly as-is, just marks
 * the queue row decided so it stops showing up. 'screen' re-scores the
 * candidate against THIS project's JD and reuses
 * transferScreeningToProject's existing "rescore" path (same one the
 * Transfer button uses) — creates a new screening in this project's
 * pipeline, flips the old one to "transferred", and links the two so they
 * render merged instead of as two unrelated cards.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; screeningId: string }> }
) {
  const { id, screeningId: screeningIdParam } = await params;
  const projectId = parseInt(id, 10);
  const screeningId = parseInt(screeningIdParam, 10);
  if (isNaN(projectId) || isNaN(screeningId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || (body.decision !== "screen" && body.decision !== "skip")) {
    return NextResponse.json({ error: "decision must be \"screen\" or \"skip\"" }, { status: 400 });
  }

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessProject(user, projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const row = await getArchiveFitRow(projectId, screeningId);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status !== "pending") {
    return NextResponse.json({ error: "Already decided" }, { status: 409 });
  }

  try {
    if (body.decision === "skip") {
      await decideArchiveFit(row.id, "skipped", undefined, user.id);
      return NextResponse.json({ ok: true, decision: "skipped" });
    }

    const project = await getProject(projectId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const resume = await getScreeningResume(screeningId);
    const resumeText = await extractResumeText(resume.fileName, resume.data);
    const rescoredResult = await scoreCandidate(project.jobDescription, resume.fileName, resumeText, [], project.name);

    const { newScreeningId } = await transferScreeningToProject({
      screeningId,
      destinationProjectId: projectId,
      actingUserId: user.id,
      mode: "rescore",
      rescoredResult,
    });

    await decideArchiveFit(row.id, "screened", newScreeningId, user.id);
    return NextResponse.json({ ok: true, decision: "screened", newScreeningId });
  } catch (err) {
    console.error("Archive fits decide error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
