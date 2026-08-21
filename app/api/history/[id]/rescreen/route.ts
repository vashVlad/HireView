import { NextRequest, NextResponse } from "next/server";
import { getScreeningsByIds, getScreeningResume, updateScreening } from "@/lib/screenings";
import { getProject, getProjectChecklist } from "@/lib/projects";
import { listCalibrationExamples } from "@/lib/calibrationExamples";
import { extractResumeText } from "@/lib/parseResume";
import { scoreCandidate } from "@/lib/scoreCandidate";
import { evaluateChecklist, computeChecklistPercentageScore } from "@/lib/evaluateChecklist";
import { computeTargetCompanyBoost, combineTargetCompanies } from "@/lib/targetCompanyBoost";
import { canAccessScreening, getAuthUser } from "@/lib/auth";
import type { ChecklistEvaluation } from "@/lib/types";

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

    // Real gap found 2026-08-17 (checklist-only-scoring round): this route
    // called scoreCandidate() directly and wrote its raw result.score with
    // no checklist or target-company adjustment at all — the ONLY caller of
    // saveScreening() (app/api/screen-resumes/route.ts, do-not-touch) got
    // both, but a rescreen bypasses saveScreening() entirely (it patches an
    // existing row via updateScreening() instead), so neither ever applied
    // here. Harmless under the old additive model (a rescore just missed a
    // small bonus), but a real correctness bug now that a project WITH a
    // checklist configured is supposed to have score computed ENTIRELY from
    // it (Vlad's explicit ask — see lib/evaluateChecklist.ts's
    // computeChecklistPercentageScore comment) — rescreening such a
    // candidate would have silently reverted them to the AI's own 0-100
    // judgment instead. Mirrors lib/screenings.ts's saveScreening() ordering
    // exactly: checklist sets the base score first (falls back to the AI's
    // own score if no checklist, or the checklist has zero total points),
    // target-company boost stacks on top of whichever base that leaves.
    let checklistEvaluation: ChecklistEvaluation | null = null;
    const checklist = await getProjectChecklist(project.id).catch(() => null);
    if (checklist) {
      checklistEvaluation = await evaluateChecklist({ resumeText, checklist }).catch((err) => {
        console.error("Checklist evaluation failed during rescreen (score falls back to the AI's own judgment):", err);
        return null;
      });
      if (checklistEvaluation) {
        const checklistScore = computeChecklistPercentageScore(checklistEvaluation.results);
        if (checklistScore !== null) result.score = checklistScore;
      }
    }

    const targetCompanies = combineTargetCompanies(project.jdAnalysis?.wide?.targetCompanies, project.jdAnalysis?.narrow?.targetCompanies);
    if (targetCompanies.length > 0) {
      const boost = computeTargetCompanyBoost(resumeText, targetCompanies);
      if (boost.matched) {
        result.score = Math.min(100, result.score + boost.bonus);
      }
      result.targetCompanyMatches = boost.matchedCompanies;
    }

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
        // Real gap found and fixed 2026-08-17 (roadmap 2.5.2 verification
        // pass): scoreCandidate() has returned trajectoryEntries since the
        // do-not-touch exception landed, and updateScreening() has
        // supported writing it since the same round — but this route's own
        // payload was never updated to actually pass it through, so
        // rescreening an existing candidate silently dropped it. This is
        // the ONLY path (short of a real re-upload) that lets an
        // already-screened candidate pick up structured trajectory data
        // without a dedicated backfill script, which deliberately doesn't
        // exist for this column — see supabase-migration-trajectory-
        // entries.sql's own comment.
        trajectoryEntries: result.trajectoryEntries,
        recommendation: result.recommendation,
        ...(checklistEvaluation !== null ? { checklistEvaluation } : {}),
        ...(result.targetCompanyMatches !== undefined ? { targetCompanyMatches: result.targetCompanyMatches } : {}),
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
        trajectoryEntries: result.trajectoryEntries,
        recommendation: result.recommendation,
        checklistEvaluation: checklistEvaluation ?? undefined,
        targetCompanyMatches: result.targetCompanyMatches,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Rescreen failed" },
      { status: 500 }
    );
  }
}
