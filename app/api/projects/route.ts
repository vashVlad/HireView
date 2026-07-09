import { NextRequest, NextResponse } from "next/server";
import { createProject, getProjectSummaries } from "@/lib/projects";
import { getAuthUser, teamIdsFilter } from "@/lib/auth";
import { getPrimaryTeamId } from "@/lib/teams";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const teamIds = await teamIdsFilter(user);

  try {
    const projects = await getProjectSummaries(teamIds);
    return NextResponse.json({ projects });
  } catch (err) {
    console.error("Projects GET error:", err);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = user.id; // Always save with the creator's user ID

  const body = await request.json().catch(() => null);
  if (!body?.name?.trim() || !body?.jobDescription?.trim()) {
    return NextResponse.json(
      { error: "name and jobDescription are required" },
      { status: 400 }
    );
  }
  try {
    // Auto-assigned from the creator's own team membership — not client-supplied.
    // Once someone belongs to 2+ teams this needs a selector; everyone's on
    // exactly one team today, so there's nothing to choose between yet.
    const teamId = await getPrimaryTeamId(userId);
    const project = await createProject({
      name: body.name,
      jobDescription: body.jobDescription,
      jdAnalysis: body.jdAnalysis ?? undefined,
      userId,
      teamId,
    });
    return NextResponse.json({ project });
  } catch (err) {
    console.error("Projects POST error:", err);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
