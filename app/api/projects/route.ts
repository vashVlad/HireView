import { NextRequest, NextResponse } from "next/server";
import { createProject, getProjectSummaries } from "@/lib/projects";

export async function GET() {
  try {
    const projects = await getProjectSummaries();
    return NextResponse.json({ projects });
  } catch (err) {
    console.error("Projects GET error:", err);
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.name?.trim() || !body?.jobDescription?.trim()) {
    return NextResponse.json(
      { error: "name and jobDescription are required" },
      { status: 400 }
    );
  }
  try {
    const project = await createProject({
      name: body.name,
      jobDescription: body.jobDescription,
      jdAnalysis: body.jdAnalysis ?? undefined,
    });
    return NextResponse.json({ project });
  } catch (err) {
    console.error("Projects POST error:", err);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
