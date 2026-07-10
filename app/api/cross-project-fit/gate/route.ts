import { NextRequest, NextResponse } from "next/server";
import { extractResumeText } from "@/lib/parseResume";
import { listProjects } from "@/lib/projects";
import { getUserTeamIds } from "@/lib/teams";
import { getAuthUser } from "@/lib/auth";
import { getAnthropicClient, CLAUDE_MODEL } from "@/lib/anthropic";

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

  const formData = await request.formData();
  const resumeFile = formData.get("resumeFile");
  const currentProjectIdField = formData.get("currentProjectId");

  if (!(resumeFile instanceof File)) {
    return NextResponse.json({ error: "resumeFile is required" }, { status: 400 });
  }
  const currentProjectId = typeof currentProjectIdField === "string" && currentProjectIdField.trim()
    ? parseInt(currentProjectIdField.trim(), 10) || undefined
    : undefined;

  const teamIds = await getUserTeamIds(user.id);
  if (teamIds.length === 0) return NextResponse.json({ promising: false });

  const projects = await listProjects(teamIds);
  const candidates = projects.filter(
    (p) => p.id !== currentProjectId && p.status === "active" && p.jobDescription.trim().length > 0
  );
  if (candidates.length === 0) return NextResponse.json({ promising: false });

  let resumeText: string;
  try {
    const buffer = Buffer.from(await resumeFile.arrayBuffer());
    resumeText = await extractResumeText(resumeFile.name, buffer);
  } catch {
    return NextResponse.json({ promising: false });
  }

  // Short role summaries, not full JDs — this is the "cheap" half of the
  // cost savings versus POST (the other half is the minimal output schema
  // below: one boolean, not a full scored result per project).
  const roleList = candidates
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
      return NextResponse.json({ promising: false });
    }
    const promising = Boolean((toolUse.input as { promising?: boolean }).promising);
    return NextResponse.json({ promising });
  } catch (err) {
    console.error("Cross-project gate error:", err);
    return NextResponse.json({ promising: false });
  }
}
