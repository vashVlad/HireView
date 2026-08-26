import { NextRequest, NextResponse } from "next/server";
import { getScreeningsByIds, getScreeningResume } from "@/lib/screenings";
import { getProject, getProjectChecklist } from "@/lib/projects";
import { listCalibrationExamples } from "@/lib/calibrationExamples";
import { extractResumeText } from "@/lib/parseResume";
import { scoreCandidate } from "@/lib/scoreCandidate";
import { evaluateGate1 } from "@/lib/evaluateGate1";
import { buildGate1ArchivedResult } from "@/lib/buildGate1ArchivedResult";
import { extractGithubUsername, fetchGithubCorroboration } from "@/lib/githubCorroboration";
import { combineTargetCompanies, computeTargetCompanyBoost } from "@/lib/targetCompanyBoost";
import { canAccessScreening, canAccessProject, getAuthUser } from "@/lib/auth";
import { errorMessage } from "@/lib/errorMessage";
import type { CandidateResult } from "@/lib/types";

// Raised from 60 to 300, 2026-08-26 (found while investigating a real
// "rescreen failed" report, then auditing every route with this same
// shape) — Gate 1 was added to THIS route earlier today (see this file's
// own header comment: "same pattern as rescreen/route.ts") and shares its
// exact architecture: evaluateGate1() runs a real Claude call
// (evaluateChecklist under the hood) that MUST resolve before deciding
// whether to call scoreCandidate() at all — two sequential real Claude
// calls when a checklist exists and gate1 passes, the identical shape that
// broke rescreen at 60s. Raised to match the established precedent
// (screen-resumes/route.ts, screenings/save-one/route.ts, rescreen/route.ts
// all at 300 for this same root cause) rather than wait for this route to
// fail the same way. Same Vercel-plan caveat as those files.
export const maxDuration = 300;

/**
 * Step 2 of the redesigned Transfer flow (Vlad's ask, 2026-07-29) — only
 * called when a recruiter flips TransferControl's "Screen for this project
 * now" toggle on, after /transfer/precheck already confirmed the candidate
 * has no existing screening in the destination project. Runs a REAL
 * scoreCandidate call against the destination project's own JD and
 * calibration library — same pattern as
 * app/api/history/[id]/rescreen/route.ts, just scoring against a different
 * project's JD instead of this screening's own project — but deliberately
 * does NOT save anything. The recruiter sees the resulting score in the
 * popover first; only a subsequent POST to /transfer (mode: "rescore",
 * carrying this exact result back) actually persists a new screening row.
 * This avoids ever scoring the same resume twice for one transfer.
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

    const resume = await getScreeningResume(screeningId);
    const resumeText = await extractResumeText(resume.fileName, resume.data);

    // Same derivation as app/api/screen-resumes/route.ts (do-not-touch) —
    // first non-empty line of the destination JD as a concise role label.
    const roleContext = destinationProject.jobDescription
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0);

    const calibrationExamples = await listCalibrationExamples(destinationProject.id).catch(() => []);

    // 2026-08-26 consistency-audit fix (Vlad's explicit answer to "should
    // Transfer preview gate like every other scoreCandidate() path": "Yes,
    // add Gate 1"). Same cheap-before-expensive shape as
    // archive-fits/decide/route.ts — evaluateChecklist() runs first if the
    // DESTINATION project has one configured; below its threshold, the
    // preview returns the same buildGate1ArchivedResult stand-in a fresh
    // screening into that project would produce, instead of silently
    // bypassing a gate every other entry point respects.
    const checklist = await getProjectChecklist(destinationProject.id).catch(() => null);
    const gate1 = await evaluateGate1({ checklist, resumeText, scoreThreshold: destinationProject.scoreThreshold });
    const checklistEvaluation = gate1.checklistEvaluation;

    const githubUsername = extractGithubUsername(resumeText);

    let result: CandidateResult;
    if (gate1.gate1Only) {
      result = await buildGate1ArchivedResult({
        fileName: resume.fileName,
        resumeText,
        checklistScore: gate1.checklistScore!,
        checklistEvaluation: checklistEvaluation!,
      });
    } else {
      // Same consistency-audit fix — GitHub extraction (every other
      // scoreCandidate() path runs this) and the target-company boost
      // (every other path that persists a real screening applies this) were
      // both silently skipped here, so a previewed score could differ from
      // what actually gets saved once the recruiter accepts the transfer.
      const [scoreResult, githubSignal] = await Promise.all([
        scoreCandidate(
          destinationProject.jobDescription,
          resume.fileName,
          resumeText,
          calibrationExamples,
          roleContext,
          destinationProject.jdAnalysis?.linkedInContext ?? undefined,
          screening.linkedInMode
        ),
        githubUsername
          ? fetchGithubCorroboration(githubUsername).catch((err) => {
              console.error("GitHub corroboration lookup failed during transfer preview (scoring unaffected):", err);
              return null;
            })
          : Promise.resolve(null),
      ]);
      result = scoreResult;
      if (githubSignal) result.githubSignal = githubSignal;

      const targetCompanies = combineTargetCompanies(destinationProject.jdAnalysis?.wide?.targetCompanies, destinationProject.jdAnalysis?.narrow?.targetCompanies);
      if (targetCompanies.length > 0) {
        const boost = computeTargetCompanyBoost(resumeText, targetCompanies);
        if (boost.matched) result.score = Math.min(100, result.score + boost.bonus);
        result.targetCompanyMatches = boost.matchedCompanies;
      }
    }

    return NextResponse.json({ result, checklistEvaluation: checklistEvaluation ?? undefined, gate1Only: gate1.gate1Only });
  } catch (err) {
    console.error("Transfer preview failed:", err);
    // See lib/errorMessage.ts — Supabase throws plain PostgrestError-shaped
    // objects, not real Error instances, so `err instanceof Error` alone
    // was silently swallowing the actual failure message here too.
    return NextResponse.json({ error: errorMessage(err, "Screening failed") }, { status: 500 });
  }
}
