import { NextRequest, NextResponse } from "next/server";
import { extractResumeText } from "@/lib/parseResume";
import { scoreCandidate } from "@/lib/scoreCandidate";
import { getFitExclusionMap, listProjects } from "@/lib/projects";
import { getUserTeamIds } from "@/lib/teams";
import { getAuthUser } from "@/lib/auth";
import { findProjectsWithCandidate } from "@/lib/screenings";
import type { CandidateResult } from "@/lib/types";

export const maxDuration = 60;

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
}

/**
 * Feature 2.1 — Cross-Project Fit Suggestion (HireView_Enterprise_Plan.md).
 * A candidate who scored below threshold on the active role gets re-scored
 * against every other active project in the same team, surfacing the best
 * match if one clears that project's own bar. Deliberately stateless — no
 * new schema, nothing persisted; this is an on-demand suggestion the
 * recruiter triggers, not a background job.
 *
 * Always scoped by the caller's own team membership (not teamIdsFilter's
 * admin-sees-everything behavior) — "same team" is the point of the
 * feature, so an admin shouldn't get suggestions spanning teams they don't
 * work on.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const resumeFile = formData.get("resumeFile");
  const currentProjectIdField = formData.get("currentProjectId");
  const candidateNameField = formData.get("candidateName");
  const currentScoreField = formData.get("currentScore");

  if (!(resumeFile instanceof File)) {
    return NextResponse.json({ error: "resumeFile is required" }, { status: 400 });
  }
  const currentProjectId = typeof currentProjectIdField === "string" && currentProjectIdField.trim()
    ? parseInt(currentProjectIdField.trim(), 10) || undefined
    : undefined;
  const candidateName = typeof candidateNameField === "string" ? candidateNameField.trim() : "";
  // Vlad's ask, 2026-07-30: a "stronger fit" has to actually score higher
  // than what the candidate already scored on the role they were screened
  // against — see the `best` filter below. Left undefined if the caller
  // ever omits it, which the filter treats as "no floor" so a missing
  // field degrades to the old behavior rather than silently suppressing
  // every suggestion.
  const currentScore = typeof currentScoreField === "string" && currentScoreField.trim()
    ? parseInt(currentScoreField.trim(), 10)
    : undefined;

  const teamIds = await getUserTeamIds(user.id);
  if (teamIds.length === 0) {
    return NextResponse.json({ suggestion: null, alreadyIn: [] });
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
    return NextResponse.json({ suggestion: null, alreadyIn: [] });
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
    return NextResponse.json({ suggestion: null, alreadyIn });
  }

  let resumeText: string;
  try {
    const buffer = Buffer.from(await resumeFile.arrayBuffer());
    resumeText = await extractResumeText(resumeFile.name, buffer);
  } catch {
    return NextResponse.json({ error: "Could not read the resume file" }, { status: 400 });
  }

  // Score against each remaining candidate project, 3 at a time — same
  // concurrency cap as the primary screening route, for the same
  // rate-limit reason. The full result + jobDescription ride along so a
  // "Transfer" action can save directly via /api/screenings/save-one
  // without re-scoring.
  const scored: {
    projectId: number;
    projectName: string;
    score: number;
    threshold: number;
    result: CandidateResult;
    jobDescription: string;
  }[] = [];
  const CONCURRENCY = 3;
  for (let i = 0; i < toScore.length; i += CONCURRENCY) {
    const batch = toScore.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (project) => {
        try {
          const result = await scoreCandidate(project.jobDescription, resumeFile.name, resumeText, [], project.name);
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

  // Only surface a suggestion that would actually clear the other project's
  // own bar — a "better fit" that still wouldn't pass isn't a real
  // suggestion. Also, 2026-07-30 (Vlad's ask): it has to actually score
  // higher than the candidate's score on the project they were screened
  // against — otherwise calling it a "stronger fit" is wrong even if it
  // clears the other project's own threshold (e.g. scoring 54 on a 50-point
  // bar here isn't "stronger" than the 60 they already scored elsewhere).
  const best = scored
    .filter((s) => s.score >= s.threshold && (currentScore == null || s.score > currentScore))
    .sort((a, b) => b.score - a.score)[0];

  return NextResponse.json({
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
}
