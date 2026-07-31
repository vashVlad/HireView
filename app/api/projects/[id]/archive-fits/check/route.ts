import { NextRequest, NextResponse } from "next/server";
import { canAccessProject, getAuthUser } from "@/lib/auth";
import { getProject, listProjects } from "@/lib/projects";
import { getUserTeamIds } from "@/lib/teams";
import { getAnthropicClient, CLAUDE_MODEL } from "@/lib/anthropic";
import { getKnownArchiveFitScreeningIds, insertPendingArchiveFits, listArchivedCandidatesWithRoleFits } from "@/lib/archiveFits";

export const maxDuration = 30;

const CHECK_TOOL = {
  name: "submit_archive_fit_matches",
  description: "Return which candidate numbers plausibly fit this project's role, based on their suggested role fits.",
  input_schema: {
    type: "object" as const,
    properties: {
      matchingCandidateNumbers: {
        type: "array",
        items: { type: "number" },
        description: "Numbers (from the numbered list) of candidates whose suggested role fit(s) plausibly align with this project's JD. Empty array if none do.",
      },
    },
    required: ["matchingCandidateNumbers"],
  },
};

/**
 * Archive Fits, 2026-07-30 — on-demand check triggered from a project's
 * Settings tab (Vlad's ask: "that check is allowed only during the new role
 * creation or project settings"). Pulls every archived candidate across the
 * recruiter's other team projects that carries a suggested_role_fit, and
 * runs one cheap Claude classification call against this project's JD —
 * same one-call-for-a-batch shape as /api/cross-project-fit/gate, not one
 * call per candidate. Matches get a 'pending' row in archive_fit_candidates;
 * a recruiter then works through them on the Archive Fits tab.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const projectId = parseInt(id, 10);
  if (isNaN(projectId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessProject(user, projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!project.jobDescription.trim()) {
    return NextResponse.json({ checked: 0, matched: 0 });
  }

  const teamIds = await getUserTeamIds(user.id);
  if (teamIds.length === 0) return NextResponse.json({ checked: 0, matched: 0 });

  // Same-team, excluding this project itself — an archived candidate from
  // THIS project already had its decision made, nothing to re-suggest.
  const otherProjectIds = (await listProjects(teamIds)).map((p) => p.id).filter((pid) => pid !== projectId);
  const pool = await listArchivedCandidatesWithRoleFits(otherProjectIds);
  if (pool.length === 0) return NextResponse.json({ checked: 0, matched: 0 });

  // Skip anything already in this project's queue (pending, skipped, or
  // screened) — a re-run of "check" should never re-classify or resurrect a
  // decision already made.
  const known = await getKnownArchiveFitScreeningIds(projectId);
  const toClassify = pool.filter((c) => !known.has(c.screeningId));
  if (toClassify.length === 0) return NextResponse.json({ checked: 0, matched: 0 });

  const candidateList = toClassify
    .map((c, i) => `${i + 1}. ${c.candidateName} — suggested fit(s): ${c.suggestedRoleFits.join(", ")}`)
    .join("\n");

  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 300,
      tools: [CHECK_TOOL],
      tool_choice: { type: "tool", name: "submit_archive_fit_matches" },
      messages: [
        {
          role: "user",
          content: `JOB DESCRIPTION for the new role:\n${project.jobDescription.slice(0, 4000)}\n\nARCHIVED CANDIDATES (each was archived from a different role, with a recruiter- or AI-suggested better-fit role attached):\n${candidateList}\n\nWhich candidate numbers plausibly fit this new role, based on their suggested fit(s)? Be selective — only include a real plausible match, not a loose keyword overlap.`,
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    const numbers = toolUse && toolUse.type === "tool_use"
      ? ((toolUse.input as { matchingCandidateNumbers?: number[] }).matchingCandidateNumbers ?? [])
      : [];

    const matches = numbers
      .map((n) => toClassify[n - 1])
      .filter((c): c is (typeof toClassify)[number] => c != null)
      .map((c) => ({ screeningId: c.screeningId, suggestedRoleFit: c.suggestedRoleFits[0] }));

    await insertPendingArchiveFits(projectId, matches, user.id);
    return NextResponse.json({ checked: toClassify.length, matched: matches.length });
  } catch (err) {
    console.error("Archive fits check error:", err);
    return NextResponse.json({ error: "Check failed" }, { status: 500 });
  }
}
