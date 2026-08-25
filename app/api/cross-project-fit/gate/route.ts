import { NextRequest, NextResponse } from "next/server";
import { extractResumeText } from "@/lib/parseResume";
import { getFitExclusionMap, listProjects } from "@/lib/projects";
import { getUserTeamIds } from "@/lib/teams";
import { getAuthUser } from "@/lib/auth";
import { getAnthropicClient, CLAUDE_MODEL } from "@/lib/anthropic";
import { findProjectsWithCandidate } from "@/lib/screenings";

export const maxDuration = 30;

const GATE_TOOL = {
  name: "submit_gate_decision",
  description: "Decide whether this candidate is plausibly a strong fit for any of the listed other open roles.",
  input_schema: {
    type: "object" as const,
    properties: {
      promising: {
        type: "boolean",
        description:
          "True only if the candidate's actual experience plausibly clears the bar (would likely score 70+) for at least one listed role — judged the way an experienced recruiter would, inferring relevant capability from what they've actually built rather than requiring literal keyword matches. False if none of the roles are a real fit.",
      },
      reason: {
        type: "string",
        description: "One short phrase (10 words max) explaining the call, for logging only.",
      },
    },
    required: ["promising"],
  },
};

/**
 * Auto-fire gate for the cross-project fit check — replaces a client-side
 * keyword-overlap gate (dropped 2026-07-10) that matched against
 * `careerTrajectory`, a summary `scoreCandidate` generates scoped to "the
 * role being hired for" (the CURRENT project). That structural bias meant a
 * candidate could be a genuine 80+ fit elsewhere and still show ~1/5 literal
 * keyword overlap, because their current-role summary never had a reason to
 * mention the other role's vocabulary. See decisions-log 2026-07-10.
 *
 * This route re-extracts the actual resume text (same as POST below, not
 * the project-scoped summary) and asks a single cheap Claude call whether
 * the candidate is plausibly worth a full check — one small classification
 * call with a one-line answer, versus POST's N full scoring passes each
 * producing a complete strengths/concerns/trajectory writeup. Real
 * semantic judgment, not string matching, but not free — this still costs
 * an API call per below-threshold candidate. Fails closed (promising:
 * false) on any error, so a broken gate can only ever suppress auto-fire,
 * never crash the results view or block the manual "Check other active
 * roles" link, which is unaffected by this route either way.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Real error handling, 2026-08-25 — this route's own doc comment above
  // promises "fails closed (promising: false) on any error," but that
  // wasn't actually true: getUserTeamIds()/listProjects() below throw raw
  // on a Supabase error, which (with nothing catching it) would have
  // produced an unhandled 500, not the documented graceful fallback. Now
  // logged with console.error for diagnosis, but still resolves to the
  // documented `{ promising: false, alreadyIn: [] }` shape rather than an
  // error response — this route genuinely should never surface a visible
  // error to the recruiter, unlike POST /api/cross-project-fit.
  try {

  const formData = await request.formData();
  const resumeFile = formData.get("resumeFile");
  const currentProjectIdField = formData.get("currentProjectId");
  const candidateNameField = formData.get("candidateName");

  if (!(resumeFile instanceof File)) {
    return NextResponse.json({ error: "resumeFile is required" }, { status: 400 });
  }
  const currentProjectId = typeof currentProjectIdField === "string" && currentProjectIdField.trim()
    ? parseInt(currentProjectIdField.trim(), 10) || undefined
    : undefined;
  const candidateName = typeof candidateNameField === "string" ? candidateNameField.trim() : "";

  const teamIds = await getUserTeamIds(user.id);
  if (teamIds.length === 0) return NextResponse.json({ promising: false, alreadyIn: [] });

  const projects = await listProjects(teamIds);
  const baseCandidates = projects.filter(
    (p) => p.id !== currentProjectId && p.status === "active" && p.jobDescription.trim().length > 0
  );
  // Same exclusion toggle as POST /api/cross-project-fit (Vlad's ask,
  // 2026-07-30) — a project opted out via Settings should never be
  // classified as a candidate here either, not just skipped in the full check.
  const excluded = await getFitExclusionMap(baseCandidates.map((p) => p.id));
  const candidates = baseCandidates.filter((p) => !excluded.has(p.id));
  if (candidates.length === 0) return NextResponse.json({ promising: false, alreadyIn: [] });

  // Free (no Claude call) pre-check, same as POST's full check, Vlad's ask
  // 2026-07-28: if the candidate is already screened in a project, there's
  // nothing to classify it for — exclude it before the (paid) gate call.
  // 2026-07-30: now carries screeningId + score too — see POST's matching comment.
  const alreadyInMap = candidateName
    ? await findProjectsWithCandidate({ candidateName, projectIds: candidates.map((p) => p.id) })
    : new Map<number, { screeningId: number; score: number }>();
  const alreadyIn = candidates
    .filter((p) => alreadyInMap.has(p.id))
    .map((p) => ({ projectId: p.id, projectName: p.name, ...alreadyInMap.get(p.id)! }));
  const remaining = candidates.filter((p) => !alreadyInMap.has(p.id));

  // Nothing left to classify — every other active project already has this
  // candidate. Return without spending a Claude call at all.
  if (remaining.length === 0) return NextResponse.json({ promising: false, alreadyIn });

  let resumeText: string;
  try {
    const buffer = Buffer.from(await resumeFile.arrayBuffer());
    resumeText = await extractResumeText(resumeFile.name, buffer);
  } catch {
    return NextResponse.json({ promising: false, alreadyIn });
  }

  // Short role summaries, not full JDs — this is the "cheap" half of the
  // cost savings versus POST (the other half is the minimal output schema
  // below: one boolean, not a full scored result per project).
  const roleList = remaining
    .map((p) => `- ${p.name}: ${(p.jdAnalysis?.mustHaveSkills ?? []).join(", ") || "(no analyzed requirements on file)"}`)
    .join("\n");

  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 200,
      tools: [GATE_TOOL],
      tool_choice: { type: "tool", name: "submit_gate_decision" },
      messages: [
        {
          role: "user",
          content: `Resume:\n\n${resumeText.slice(0, 8000)}\n\nOther open roles on this recruiter's team:\n${roleList}\n\nThis candidate did not clear the bar for the role they were originally screened against. Based on their actual experience above, would they plausibly be a strong fit (70+) for any of the roles listed?`,
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json({ promising: false, alreadyIn });
    }
    const promising = Boolean((toolUse.input as { promising?: boolean }).promising);
    return NextResponse.json({ promising, alreadyIn });
  } catch (err) {
    console.error("Cross-project gate error:", err);
    return NextResponse.json({ promising: false, alreadyIn });
  }
  } catch (err) {
    console.error("Cross-project gate error (outer):", err);
    return NextResponse.json({ promising: false, alreadyIn: [] });
  }
}
