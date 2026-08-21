import { NextRequest, NextResponse } from "next/server";
import { canAccessProject, getAuthUser } from "@/lib/auth";
import { getProject, getProjectChecklist } from "@/lib/projects";
import { getScreeningResume, transferScreeningToProject } from "@/lib/screenings";
import { extractResumeText } from "@/lib/parseResume";
import { scoreCandidate } from "@/lib/scoreCandidate";
import { evaluateGate1 } from "@/lib/evaluateGate1";
import { buildGate1ArchivedResult } from "@/lib/buildGate1ArchivedResult";
import { decideArchiveFit, getArchiveFitRow } from "@/lib/archiveFits";
import type { CandidateResult } from "@/lib/types";

export const maxDuration = 60;

/**
 * Archive Fits, 2026-07-30 — a recruiter's decision on one queued match.
 * 'skip' leaves the original archived screening exactly as-is, just marks
 * the queue row decided so it stops showing up. 'screen' re-scores the
 * candidate against THIS project's JD and reuses
 * transferScreeningToProject's existing "rescore" path (same one the
 * Transfer button uses) — creates a new screening in this project's
 * pipeline, flips the old one to "transferred", and links the two so they
 * render merged instead of as two unrelated cards.
 *
 * Gate 1 wiring, 2026-08-20 (Vlad's explicit ask: "when the system
 * identifies a similar role [via Archive Fits] then the system will do the
 * same screening with the gates"). Before this fix, 'screen' called
 * scoreCandidate() directly and unconditionally — a real inconsistency once
 * Gate 1 existed: a candidate re-screened via Archive Fits into a
 * checklist-gated project bypassed the exact gate that same candidate would
 * have hit going through the normal upload flow. Mirrors
 * app/api/screen-resumes/route.ts's do-not-touch gate branch as closely as
 * this non-do-not-touch file can: evaluateChecklist() runs FIRST if the
 * destination project has one configured; below its threshold builds the
 * same lib/buildGate1ArchivedResult.ts stand-in and skips scoreCandidate()
 * entirely; otherwise (no checklist, or checklist clears the bar) falls
 * through to the real scoreCandidate() call exactly as before. maxDuration
 * raised from 30 to 60 to match — a checklist evaluation call now sometimes
 * runs before scoring, on top of the existing scoreCandidate() budget.
 *
 * Gate-decision logic extracted 2026-08-20 into lib/evaluateGate1.ts — this
 * was one of three near-identical copies of "evaluate checklist -> compare
 * to threshold -> decide gate1Only" (Claude Code's full-system audit). See
 * that file's own doc comment for why the stand-in build itself stays here
 * rather than also moving into the shared helper.
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

    // Gate 1 — same cheap-before-expensive shape as screen-resumes/route.ts.
    // Best-effort checklist read (a missing/not-yet-migrated checklist
    // column must never block this screen decision, same reasoning as that
    // do-not-touch file's own comment on this exact read).
    const checklist = await getProjectChecklist(projectId).catch(() => null);
    const gate1 = await evaluateGate1({ checklist, resumeText, scoreThreshold: project.scoreThreshold });
    const checklistEvaluation = gate1.checklistEvaluation;

    let rescoredResult: CandidateResult;
    if (gate1.gate1Only) {
      rescoredResult = await buildGate1ArchivedResult({
        fileName: resume.fileName,
        resumeText,
        checklistScore: gate1.checklistScore!,
        checklistEvaluation: checklistEvaluation!,
      });
    } else {
      rescoredResult = await scoreCandidate(project.jobDescription, resume.fileName, resumeText, [], project.name);
    }

    const { newScreeningId } = await transferScreeningToProject({
      screeningId,
      destinationProjectId: projectId,
      actingUserId: user.id,
      mode: "rescore",
      rescoredResult,
      gate1Only: gate1.gate1Only,
      checklistEvaluation,
    });

    await decideArchiveFit(row.id, "screened", newScreeningId, user.id);
    return NextResponse.json({ ok: true, decision: "screened", newScreeningId });
  } catch (err) {
    console.error("Archive fits decide error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
