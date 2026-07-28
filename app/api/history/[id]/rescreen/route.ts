import { NextRequest, NextResponse } from "next/server";
import { getScreeningsByIds, getScreeningResume, updateScreening } from "@/lib/screenings";
import { getProject } from "@/lib/projects";
import { listCalibrationExamples } from "@/lib/calibrationExamples";
import { extractResumeText } from "@/lib/parseResume";
import { scoreCandidate } from "@/lib/scoreCandidate";
import { canAccessScreening, getAuthUser } from "@/lib/auth";

export const maxDuration = 60;

/**
 * Re-runs scoring for an ALREADY-SAVED Pipeline candidate against the
 * project's CURRENT job description and calibration library, and updates
 * that same screening row in place — added 2026-07-27 (Vlad: "add a
 * rescreen button on actual pipeline cards somewhere at the bottom").
 *
 * Distinct from the pre-save "Re-screen anyway" flow on AlreadyScreenedCard
 * (handleForceRescore in app/projects/[id]/page.tsx, which calls the
 * do-not-touch /api/screen-resumes route and always creates a NEW screening
 * row): that one is for a fresh upload that exactly matched existing
 * content before any Claude call ran. This route is for a candidate who's
 * already fully in the pipeline — the point is refreshing a stale score
 * (JD edited, more calibration examples accumulated since) without losing
 * their stage, notes, flags, or history. Deliberately does NOT touch status
 * — a rescore should never silently move someone off a stage a recruiter
 * already put them in, even if the new score crosses the project's
 * auto-archive threshold.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const screeningId = Number(id);
  if (!Number.isInteger(screeningId)) {
    return NextResponse.json({ error: "Invalid screening id" }, { status: 400 });
  }

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessScreening(user, screeningId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const [screening] = await getScreeningsByIds([screeningId]);
    if (!screening) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (screening.projectId == null) {
      return NextResponse.json(
        { error: "This candidate isn't attached to a project — nothing to rescreen against." },
        { status: 400 }
      );
    }

    const project = await getProject(screening.projectId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const resume = await getScreeningResume(screeningId);
    const resumeText = await extractResumeText(resume.fileName, resume.data);

    // Same derivation as app/api/screen-resumes/route.ts (do-not-touch) —
    // first non-empty line of the JD as a concise role label for Claude.
    const roleContext = project.jobDescription
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0);

    const calibrationExamples = await listCalibrationExamples(project.id).catch(() => []);

    const result = await scoreCandidate(
      project.jobDescription,
      resume.fileName,
      resumeText,
      calibrationExamples,
      roleContext,
      project.jdAnalysis?.linkedInContext ?? undefined,
      screening.linkedInMode
    );

    await updateScreening(
      screeningId,
      {
        score: result.score,
        mustHaveScore: result.mustHaveScore,
        niceToHaveScore: result.niceToHaveScore,
        summary: result.summary,
        strengths: result.strengths,
        concerns: result.concerns,
        careerTrajectory: result.careerTrajectory,
        recommendation: result.recommendation,
      },
      user.id
    );

    return NextResponse.json({
      screening: {
        score: result.score,
        mustHaveScore: result.mustHaveScore,
        niceToHaveScore: result.niceToHaveScore,
        summary: result.summary,
        strengths: result.strengths,
        concerns: result.concerns,
        careerTrajectory: result.careerTrajectory,
        recommendation: result.recommendation,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Rescreen failed" },
      { status: 500 }
    );
  }
}
