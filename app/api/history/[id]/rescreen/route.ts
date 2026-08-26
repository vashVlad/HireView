import { NextRequest, NextResponse } from "next/server";
import { getScreeningsByIds, getScreeningResume, updateScreening } from "@/lib/screenings";
import { getProject, getProjectChecklist } from "@/lib/projects";
import { listCalibrationExamples } from "@/lib/calibrationExamples";
import { extractResumeText } from "@/lib/parseResume";
import { scoreCandidate } from "@/lib/scoreCandidate";
import { extractGithubUsername, fetchGithubCorroboration } from "@/lib/githubCorroboration";
import { evaluateChecklist } from "@/lib/evaluateChecklist";
import { computeTargetCompanyBoost, combineTargetCompanies } from "@/lib/targetCompanyBoost";
import { canAccessScreening, getAuthUser } from "@/lib/auth";

// Raised from 60 to 300, 2026-08-26 (found while investigating a real
// "rescreen failed" report) — this route runs TWO real, sequential Claude
// calls when the project has a checklist configured (scoreCandidate(), then
// evaluateChecklist() below, one after the other), on top of resume
// extraction and calibration-example loading. 60s was already a tight
// budget for one scoreCandidate() call alone; two sequential calls can
// plausibly exceed it, especially for a longer resume or a slow API
// response — this route was simply never given the same fix
// screen-resumes/route.ts and screenings/save-one/route.ts got on
// 2026-07-29 for the exact same root cause (see decisions-log.md). Same
// Vercel-plan caveat as those two files: this only deploys cleanly on a
// Pro/Enterprise plan, or Hobby with Fluid Compute enabled (already proven
// safe on this project's plan, since those two routes deploy fine at 300).
// Paired with parallelizing evaluateChecklist() into the same Promise.all
// as scoreCandidate() below — it doesn't depend on the score result, so
// there's no reason to make it wait — which independently cuts the
// worst-case duration roughly in half for a checklist-configured project.
export const maxDuration = 300;

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

    // Real gap found 2026-08-26 (Vlad: "Rescreening must serve exactly the
    // same purpose as the initial screening") — GitHub extraction/lookup
    // (lib/githubCorroboration.ts, added to screen-resumes/route.ts earlier
    // the same day) never ran here at all, so a rescreen could only ever
    // leave a candidate's GitHub panel stale or blank. Same free, code-side,
    // best-effort pattern as screen-resumes/route.ts's third parallel
    // branch — username extraction is a synchronous regex match, cost-free
    // either way; the network fetch only fires when one was actually found.
    const githubUsername = extractGithubUsername(resumeText);
    // Checklist fetched here (cheap DB read, not a Claude call) so
    // evaluateChecklist() below — a real, separate Claude call — can run
    // IN PARALLEL with scoreCandidate() instead of waiting for it to finish
    // first. Same maxDuration comment above explains why this mattered:
    // two sequential Claude calls could plausibly exceed the old 60s ceiling
    // on their own, even before adding this fix's own extra headroom.
    const checklist = await getProjectChecklist(project.id).catch(() => null);
    const [result, githubSignal, checklistEvaluation] = await Promise.all([
      scoreCandidate(
        project.jobDescription,
        resume.fileName,
        resumeText,
        calibrationExamples,
        roleContext,
        project.jdAnalysis?.linkedInContext ?? undefined,
        screening.linkedInMode
      ),
      githubUsername
        ? fetchGithubCorroboration(githubUsername).catch((err) => {
            console.error("GitHub corroboration lookup failed during rescreen (scoring unaffected):", err);
            return null;
          })
        : Promise.resolve(null),
      checklist
        ? evaluateChecklist({ resumeText, checklist }).catch((err) => {
            console.error("Checklist evaluation failed during rescreen (breakdown just won't show; score is unaffected either way):", err);
            return null;
          })
        : Promise.resolve(null),
    ]);
    if (githubSignal) result.githubSignal = githubSignal;

    // REVISED 2026-08-26 (Vlad's explicit rule, after reviewing a rescreen
    // that stayed pinned at 100 despite mustHaveScore 92 / niceHaveScore 78):
    // "The checklist score must be overwritten with actual screening score
    // after candidate passes first gate. That score has to be used strictly
    // for gate one[,] including cross-project fit suggestions." This route
    // ALWAYS runs a real, full scoreCandidate() call above — unlike
    // screen-resumes/route.ts and archive-fits/decide/route.ts, it has no
    // Gate 1 short-circuit at all, so every candidate reaching this block
    // has, by construction, already cleared Gate 1 (or the project has no
    // checklist/gate configured). The checklist score therefore must NEVER
    // overwrite result.score here — doing so was the original 2026-08-17
    // "checklist-only-scoring round" bug, superseded once the real Gate 1/
    // Gate 2 split landed (2026-08-19/20): lib/screenings.ts's
    // saveScreening() already only lets checklistScore override score when
    // gate1Only is true (i.e. scoreCandidate() never ran, there's no real
    // score to protect) — this route's unconditional override was simply
    // never brought in line with that same rule when it was written. Fixed:
    // checklistEvaluation is still computed and attached (still needed for
    // the matched/unmatched breakdown display and the trajectory graph's
    // per-role checklist evidence), but result.score/mustHaveScore/
    // niceToHaveScore stay exactly what scoreCandidate() (and, as of the
    // score-consistency fix earlier today, its own code-computed formula)
    // returned. Target-company boost below is unaffected — it's a small,
    // additive, code-computed bonus on top of the real score, not a
    // replacement of it, so it still applies here as before.
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
        // Real gap found 2026-08-26 (Vlad: "Rescreening must serve exactly
        // the same purpose as the initial screening") — scoreCandidate()
        // has generated currentCompany/currentTitle/totalExperienceSummary/
        // linkedinUrl in the same call as scoring since 2026-08-06 (do-not-
        // touch exception), and screen-resumes/route.ts's best-effort call
        // has always written all four for a NEW screening — but this
        // route's own payload never included any of them, so rescreening an
        // already-saved candidate silently left these four (plus, as of
        // today, githubSignal) frozen at whatever they were the day the
        // candidate was first screened, even if the resume file itself
        // changed since. Same "silently dropped on rescreen" bug class as
        // trajectoryEntries above.
        currentCompany: result.currentCompany,
        currentTitle: result.currentTitle,
        totalExperienceSummary: result.totalExperienceSummary,
        linkedinUrl: result.linkedinUrl,
        ...(result.githubSignal !== undefined ? { githubSignal: result.githubSignal } : {}),
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
        currentCompany: result.currentCompany,
        currentTitle: result.currentTitle,
        totalExperienceSummary: result.totalExperienceSummary,
        linkedinUrl: result.linkedinUrl,
        githubSignal: result.githubSignal,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Rescreen failed" },
      { status: 500 }
    );
  }
}
