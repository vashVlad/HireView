import { NextRequest, NextResponse } from "next/server";
import { extractResumeText } from "@/lib/parseResume";
import { scoreCandidate } from "@/lib/scoreCandidate";
import type { CandidateResult, ScreenResumesError } from "@/lib/types";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const jobDescription = formData.get("jobDescription");
  const files = formData.getAll("resumes");

  if (typeof jobDescription !== "string" || !jobDescription.trim()) {
    return NextResponse.json(
      { error: "jobDescription is required" },
      { status: 400 }
    );
  }

  if (files.length === 0) {
    return NextResponse.json(
      { error: "At least one resume file is required" },
      { status: 400 }
    );
  }

  const results: CandidateResult[] = [];
  const errors: ScreenResumesError[] = [];

  await Promise.all(
    files.map(async (file) => {
      if (!(file instanceof File)) return;

      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const resumeText = await extractResumeText(file.name, buffer);
        const result = await scoreCandidate(jobDescription, file.name, resumeText);
        results.push(result);
      } catch (error) {
        errors.push({
          fileName: file.name,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    })
  );

  results.sort((a, b) => b.score - a.score);

  return NextResponse.json({ results, errors });
}
