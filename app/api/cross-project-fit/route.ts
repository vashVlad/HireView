import { NextRequest, NextResponse } from "next/server";
import { extractResumeText } from "@/lib/parseResume";
import { scoreCandidate } from "@/lib/scoreCandidate";
import { listCalibrationExamples } from "@/lib/calibrationExamples";
import { extractGithubUsername, fetchGithubCorroboration } from "@/lib/githubCorroboration";
import { combineTargetCompanies, computeTargetCompanyBoost } from "@/lib/targetCompanyBoost";
import { getFitExclusionMap, getProjectChecklist, listProjects } from "@/lib/projects";
import { evaluateGate1 } from "@/lib/evaluateGate1";
import { getUserTeamIds } from "@/lib/teams";
import { getAuthUser, canAccessScreening } from "@/lib/auth";
import {
  findProjectsWithCandidate,
  getGate1FitSuggestion,
  getScreeningFitContext,
  getScreeningResume,
  updateScreening,
} from "@/lib/screenings";
import type { CandidateResult, StoredFitSuggestion } from "@/lib/types";

// Raised from 60 to 300, 2026-08-26 (found while investigating a real
// "rescreen failed" report, then auditing every route with this same
// shape) — this route already runs two sequential waves of real Claude
// calls (evaluateGate1() across every other active project, THEN
// scoreCandidate() for whichever projects passed gate1 — see this file's
// own comments below on why those two waves can't be collapsed into one).
// Today's session (2026-08-26 consistency audit) also added a GitHub
// corroboration lookup here. Same root cause and same established fix as
// screen-resumes/route.ts, screenings/save-one/route.ts, rescreen/route.ts,
// transfer/preview/route.ts, and archive-fits/decide/route.ts — raised to
// match. Same Vercel-plan caveat as those files.
export const maxDuration = 300;

/**
 * A suggestion has to actually clear the other project's own bar by a real
 * margin, not just barely — Phase 2.6 Tier 2 (2026-08-20, Vlad's explicit
 * choice via AskUserQuestion: "Fixed +15 everywhere (Recommended)").
 * Replaces the old currentScore-based "must beat what they already scored on
 * THIS project" rule entirely (see the removed `currentScore` param below) —
 * that rule broke down for Gate 1 candidates, whose only "score" is a
 * checklist percentage, not a real scoreCandidate() score, so comparing the
 * two wasn't meaningful. A flat threshold + margin bar is meaningful for
 * both a Gate 2 candidate's real score and a Gate 1 candidate's checklist
 * score alike. Same value as app/projects/[id]/page.tsx's FIT_CHECK_MARGIN
 * (which gates whether the check is even offered) — deliberately kept as two
 * separate constants in two files rather than shared, since one gates
 * ELIGIBILITY (client-side, "is it even worth asking") and this one gates
 * ACCEPTANCE (server-side, "is this specific other project's score good
 * enough to suggest") — same number today by design, but conceptually
 * different questions that happen to share a value.
 */
const FIT_ACCEPT_MARGIN = 15;

/**
 * Cheap eligibility check — no scoring, no Claude call. Lets the frontend
 * decide whether it's even possible to find a cross-project fit (are there
 * other active projects in this team at all?) before spending anything on
 * the real check. Uses the exact same team-scoping as POST below, so the
 * count this returns can never disagree with what POST would actually do.
 *
 * Previously also returned other projects' must-have skills for a
 * client-side keyword-overlap auto-fire gate — dropped 2026-07-10. That
 * gate matched against `careerTrajectory`, which `scoreCandidate` generates
 * scoped to "the role being hired for" (the CURRENT project), so it
 * structurally missed genuine cross-project fits regardless of resume/JD
 * size — confirmed on a real candidate (mustHaveScore 32 on current
 * project, 82 on another, ~1/5 literal must-have overlap). See
 * decisions-log. Auto-fire now runs through POST /gate instead, a real
 * Claude classification call against the actual resume text.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Real error handling, 2026-08-25 — same fix as POST below (see its own
  // comment): getUserTeamIds()/listProjects() throw raw on a Supabase error,
  // and nothing here caught that, so a transient DB hiccup fell through to
  // Next.js's bodyless default 500 instead of a diagnosable message.
  try {

  const currentProjectIdParam = request.nextUrl.searchParams.get("currentProjectId");
  const currentProjectId = currentProjectIdParam ? parseInt(currentProjectIdParam, 10) || undefined : undefined;

  const teamIds = await getUserTeamIds(user.id);
  if (teamIds.length === 0) return NextResponse.json({ count: 0 });

  const projects = await listProjects(teamIds);
  const baseCandidates = projects.filter(
    (p) => p.id !== currentProjectId && p.status === "active" && p.jobDescription.trim().length > 0
  );
  // Vlad's ask, 2026-07-30: a project can opt out of being suggested as a
  // "better fit" target via Settings. Excluded the same way in both this
  // preview count and POST's real check below, so the number shown here can
  // never disagree with what POST would actually do — see that route's own
  // comment for why that invariant matters.
  const excluded = await getFitExclusionMap(baseCandidates.map((p) => p.id));
  const count = baseCandidates.filter((p) => !excluded.has(p.id)).length;

  return NextResponse.json({ count });
  } catch (err) {
    console.error("Cross-project fit count failed:", err);
    return NextResponse.json({ error: "Could not check other roles — see server logs for the real cause" }, { status: 500 });
  }
}

/**
 * Feature 2.1 — Cross-Project Fit Suggestion (Cirot_Enterprise_Plan.md).
 * A candidate who scored below threshold on the active role gets re-scored
 * against every other active project in the same team, surfacing the best
 * match if one clears that project's own bar.
 *
 * Two input modes, Phase 2.6 Tier 2 (2026-08-20):
 *   resumeFile — the original live flow. Stateless, nothing persisted; the
 *     browser still holds the File object from the upload that just
 *     happened (app/projects/[id]/page.tsx), so it's re-sent fresh each
 *     call. Unchanged from before this tier.
 *   screeningId — new. For a Gate 1-archived candidate reopened later (no
 *     File object survives a page reload — see app/candidates/[id]/page.tsx),
 *     the resume is re-read from Supabase storage instead. This path also
 *     persists its result (gate1_fit_suggestion) and checks for an
 *     already-persisted one FIRST, before doing any work — Vlad's ask,
 *     "once": compute lazily on first card open, never recompute after
 *     that, even if the checklist/threshold/other projects change later.
 *
 * Always scoped by the caller's own team membership (not teamIdsFilter's
 * admin-sees-everything behavior) — "same team" is the point of the
 * feature, so an admin shouldn't get suggestions spanning teams they don't
 * work on.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Real error handling, 2026-08-25 (Vlad's report: the Screen tab's
  // auto-fire "better fit" check was surfacing a generic "Could not check
  // other roles" with no way to tell why). Before this, nothing below caught
  // exceptions from getUserTeamIds()/listProjects()/findProjectsWithCandidate()
  // (all three `throw` raw on a Supabase error) — an unhandled exception in
  // any of them fell all the way through to Next.js's default 500, which has
  // no JSON body for the client to read a real message from, so it always
  // rendered as the generic client-side fallback regardless of what actually
  // failed. Now logged with console.error (visible in Vercel function logs)
  // so a future failure is diagnosable, and returned as clean JSON so the
  // client's `body?.error` path actually has something real to show.
  try {

  const formData = await request.formData();
  const resumeFile = formData.get("resumeFile");
  const screeningIdField = formData.get("screeningId");
  const currentProjectIdField = formData.get("currentProjectId");
  const candidateNameField = formData.get("candidateName");

  const hasResumeFile = resumeFile instanceof File;
  const hasScreeningId = typeof screeningIdField === "string" && screeningIdField.trim().length > 0;
  if (!hasResumeFile && !hasScreeningId) {
    return NextResponse.json({ error: "resumeFile or screeningId is required" }, { status: 400 });
  }

  let screeningId: number | undefined;
  if (hasScreeningId) {
    screeningId = parseInt(screeningIdField as string, 10);
    if (isNaN(screeningId)) return NextResponse.json({ error: "Invalid screeningId" }, { status: 400 });
    if (!(await canAccessScreening(user, screeningId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Never recompute — Vlad's ask, "once". Best-effort: a read failure
    // (including the migration not being run yet) just falls through to
    // computing fresh, same as it would for a screening that genuinely
    // hasn't been checked yet.
    const persisted = await getGate1FitSuggestion(screeningId).catch(() => null);
    if (persisted) return NextResponse.json(persisted);
  }

  // currentProjectId/candidateName come from the form for the resumeFile
  // path (the browser already has both in state); for the screeningId path
  // they're read from the screening row itself, since there's no live
  // browser state to carry them.
  let currentProjectId = typeof currentProjectIdField === "string" && currentProjectIdField.trim()
    ? parseInt(currentProjectIdField.trim(), 10) || undefined
    : undefined;
  let candidateName = typeof candidateNameField === "string" ? candidateNameField.trim() : "";
  if (screeningId != null) {
    const ctx = await getScreeningFitContext(screeningId);
    if (!ctx) return NextResponse.json({ suggestion: null, alreadyIn: [] });
    candidateName = ctx.candidateName;
    currentProjectId = ctx.projectId ?? currentProjectId;
  }

  // Persist-then-respond, Phase 2.6 Tier 2 — every successful exit below
  // (not the error responses above, which mean "couldn't check," not
  // "checked, found nothing") goes through this so the screeningId path's
  // "once" guarantee actually holds. An earlier version of this route only
  // persisted at the very end, which meant a candidate with zero other
  // eligible projects (no other active projects, or already screened
  // everywhere) recomputed — cheaply, but still a real DB round-trip and a
  // violation of "never recompute" — on every single card open. Best-effort:
  // a write failure never blocks the response itself.
  async function respond(body: StoredFitSuggestion) {
    if (screeningId != null) {
      await updateScreening(screeningId, { gate1FitSuggestion: body }).catch(() => {});
    }
    return NextResponse.json(body);
  }

  const teamIds = await getUserTeamIds(user.id);
  if (teamIds.length === 0) {
    return respond({ suggestion: null, alreadyIn: [] });
  }

  const projects = await listProjects(teamIds);
  const baseCandidates = projects.filter(
    (p) => p.id !== currentProjectId && p.status === "active" && p.jobDescription.trim().length > 0
  );
  // See GET's matching comment above — a project can opt out of being
  // suggested at all via its own Settings toggle.
  const excluded = await getFitExclusionMap(baseCandidates.map((p) => p.id));
  const candidates = baseCandidates.filter((p) => !excluded.has(p.id));

  if (candidates.length === 0) {
    return respond({ suggestion: null, alreadyIn: [] });
  }

  // Free (no Claude call) pre-check, Vlad's ask 2026-07-28: don't re-score a
  // candidate against a project they're already screened in — nothing to
  // suggest there, so exclude it from scoring and just mention it instead.
  // 2026-07-30: now carries screeningId + score too, so ResultCard can link
  // straight to that screening and show its score, not just the project name.
  const alreadyInMap = candidateName
    ? await findProjectsWithCandidate({ candidateName, projectIds: candidates.map((p) => p.id) })
    : new Map<number, { screeningId: number; score: number }>();
  const alreadyIn = candidates
    .filter((p) => alreadyInMap.has(p.id))
    .map((p) => ({ projectId: p.id, projectName: p.name, ...alreadyInMap.get(p.id)! }));
  const toScore = candidates.filter((p) => !alreadyInMap.has(p.id));

  if (toScore.length === 0) {
    return respond({ suggestion: null, alreadyIn });
  }

  let resumeText: string;
  let resumeFileName: string;
  if (hasResumeFile) {
    resumeFileName = resumeFile.name;
    try {
      const buffer = Buffer.from(await resumeFile.arrayBuffer());
      resumeText = await extractResumeText(resumeFileName, buffer);
    } catch {
      return NextResponse.json({ error: "Could not read the resume file" }, { status: 400 });
    }
  } else {
    try {
      const stored = await getScreeningResume(screeningId!);
      resumeFileName = stored.fileName;
      resumeText = await extractResumeText(stored.fileName, stored.data);
    } catch {
      return NextResponse.json({ error: "Could not read the resume file" }, { status: 400 });
    }
  }

  // Checklist pre-filter, Phase 2.6 Tier 2 (2026-08-20, Vlad's ask) — same
  // cheap-before-expensive philosophy as Gate 1 itself
  // (app/api/screen-resumes/route.ts), applied here to avoid paying for a
  // full scoreCandidate() call against every other active project when a
  // project's own checklist already makes a miss obvious. Only drops a
  // project whose checklist score would itself fail to clear that project's
  // threshold; a project with no checklist configured, a checklist read/eval
  // failure (fails open — never let this optimization suppress a real
  // suggestion), or a checklist score that clears the bar all fall through
  // to the real scoreCandidate() call below unchanged.
  //
  // Gate-decision logic extracted 2026-08-20 into lib/evaluateGate1.ts (see
  // its own doc comment) — deliberately does NOT use that helper's true
  // branch to build a full gate1Only stand-in result the way screen-resumes/
  // route.ts and archive-fits/decide/route.ts do; this loop only needs the
  // boolean to decide whether to drop a project from consideration, and
  // building the stand-in would cost an unnecessary extra Claude call per
  // filtered project (buildGate1ArchivedResult's candidate-name fallback).
  // Batched 3 at a time, 2026-08-25 (Vlad's report — the Screen tab's
  // auto-fire "better fit" check was failing with a generic error). This
  // loop used to await getProjectChecklist()+evaluateGate1() ONE PROJECT AT
  // A TIME — each with a checklist configured pays for a real, sequential
  // evaluateChecklist() Claude call, so a team with several other active
  // projects could burn many seconds here before the scoring loop below (already
  // batched 3-at-a-time) even started. Combined, that could realistically
  // exceed this route's 60s maxDuration — a Vercel timeout returns a
  // non-JSON response, which is indistinguishable client-side from any other
  // failure and rendered as the same generic "Could not check other roles."
  // Same CONCURRENCY=3 cap as the scoring loop below, for the same
  // rate-limit reason — this loop can issue real Claude calls too.
  const checklistFiltered: typeof toScore = [];
  const CHECKLIST_CONCURRENCY = 3;
  for (let i = 0; i < toScore.length; i += CHECKLIST_CONCURRENCY) {
    const batch = toScore.slice(i, i + CHECKLIST_CONCURRENCY);
    const decisions = await Promise.all(
      batch.map(async (project) => {
        const checklist = await getProjectChecklist(project.id).catch(() => null);
        const gate1 = await evaluateGate1({ checklist, resumeText, scoreThreshold: project.scoreThreshold });
        return { project, gate1Only: gate1.gate1Only };
      })
    );
    for (const d of decisions) if (!d.gate1Only) checklistFiltered.push(d.project);
  }

  // Score against each remaining candidate project, 3 at a time — same
  // concurrency cap as the primary screening route, for the same
  // rate-limit reason. The full result + jobDescription ride along so a
  // "Transfer" action can save directly via /api/screenings/save-one
  // without re-scoring.
  // 2026-08-26 consistency-audit fix (Vlad: "run check through the code and
  // see whether we use the proper information... They have to match and not
  // be ran as two different things") — this loop previously hardcoded `[]`
  // for calibrationExamples on every project and never ran GitHub
  // extraction, even though a "Transfer" action can persist this exact
  // result as-is (see the comment on `scored` below) — so an accepted
  // suggestion could get saved as a real screening that never benefited
  // from that project's calibration library or carried a GitHub signal,
  // unlike every other path that produces a persisted screening. GitHub
  // extraction only needs to run once per candidate (not once per project
  // scored against), unlike calibration examples which are genuinely
  // per-project.
  const githubUsername = extractGithubUsername(resumeText);
  const githubSignal = githubUsername
    ? await fetchGithubCorroboration(githubUsername).catch((err) => {
        console.error("GitHub corroboration lookup failed during cross-project-fit (scoring unaffected):", err);
        return null;
      })
    : null;

  const scored: {
    projectId: number;
    projectName: string;
    score: number;
    threshold: number;
    result: CandidateResult;
    jobDescription: string;
  }[] = [];
  const CONCURRENCY = 3;
  for (let i = 0; i < checklistFiltered.length; i += CONCURRENCY) {
    const batch = checklistFiltered.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (project) => {
        try {
          const calibrationExamples = await listCalibrationExamples(project.id).catch(() => []);
          const result = await scoreCandidate(project.jobDescription, resumeFileName, resumeText, calibrationExamples, project.name);
          if (githubSignal) result.githubSignal = githubSignal;
          // Target-company boost — same gap as calibration/GitHub above,
          // never applied here even though it's a deterministic bonus every
          // other scoreCandidate() path applies for its own project. Mirrors
          // saveScreening()'s own boost block exactly (lib/screenings.ts) so
          // the suggestion's displayed score matches what actually gets
          // saved if the recruiter accepts it via Transfer.
          const targetCompanies = combineTargetCompanies(project.jdAnalysis?.wide?.targetCompanies, project.jdAnalysis?.narrow?.targetCompanies);
          if (targetCompanies.length > 0) {
            const boost = computeTargetCompanyBoost(resumeText, targetCompanies);
            if (boost.matched) result.score = Math.min(100, result.score + boost.bonus);
            result.targetCompanyMatches = boost.matchedCompanies;
          }
          return {
            projectId: project.id,
            projectName: project.name,
            score: result.score,
            threshold: project.scoreThreshold,
            result,
            jobDescription: project.jobDescription,
          };
        } catch {
          return null;
        }
      })
    );
    for (const r of results) if (r) scored.push(r);
  }

  // Only surface a suggestion that clears the other project's own bar by a
  // real margin — see FIT_ACCEPT_MARGIN's own comment for why this replaced
  // the old currentScore-based comparison.
  const best = scored
    .filter((s) => s.score >= s.threshold + FIT_ACCEPT_MARGIN)
    .sort((a, b) => b.score - a.score)[0];

  return respond({
    suggestion: best
      ? {
          projectId: best.projectId,
          projectName: best.projectName,
          score: best.score,
          result: best.result,
          jobDescription: best.jobDescription,
        }
      : null,
    alreadyIn,
  });
  } catch (err) {
    console.error("Cross-project fit check failed:", err);
    return NextResponse.json({ error: "Could not check other roles — see server logs for the real cause" }, { status: 500 });
  }
}
