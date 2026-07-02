import { NextRequest, NextResponse } from "next/server";
import { extractResumeText } from "@/lib/parseResume";
import { generateTrajectory } from "@/lib/generateTrajectory";
import { getScreeningResume, listScreenings, updateScreening } from "@/lib/screenings";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const projectId: number | undefined =
    typeof body?.projectId === "number" ? body.projectId : undefined;

  let screenings;
  try {
    screenings = await listScreenings(undefined, undefined, undefined, projectId);
  } catch (err) {
    console.error("Failed to list screenings:", err);
    return NextResponse.json({ error: "Failed to fetch screenings" }, { status: 500 });
  }

  if (screenings.length === 0) {
    return NextResponse.json({ updated: 0, errors: [] });
  }

  let updated = 0;
  const errors: string[] = [];

  for (const s of screenings) {
    try {
      const { data, fileName } = await getScreeningResume(s.id!);
      const resumeText = await extractResumeText(fileName, data);
      const trajectory = await generateTrajectory(s.jobDescription, resumeText);
      await updateScreening(s.id!, { careerTrajectory: trajectory });
      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${s.candidateName}: ${msg}`);
    }
  }

  return NextResponse.json({ updated, errors });
}
