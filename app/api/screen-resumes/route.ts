import { NextRequest, NextResponse } from "next/server";
import { extractResumeText } from "@/lib/parseResume";
import { scoreCandidate } from "@/lib/scoreCandidate";
import type { CandidateResult, ScreenResumesError } from "@/lib/types";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const jobDescriptionField = formData.get("jobDescription");
  const files = formData.getAll("resumes");

  if (typeof jobDescriptionField !== "string" || !jobDescriptionField.trim()) {
    return NextResponse.json(
      { error: "jobDescription is required" },
      { status: 400 }
    );
  }
  const jobDescription: string = jobDescriptionField;

  if (files.length === 0) {
    return NextResponse.json(
      { error: "At least one resume file is required" },
      { status: 400 }
    );
  }

  const results: CandidateResult[] = [];
  const errors: ScreenResumesError[] = [];

  // Extract text for every resume first — this is local parsing, no API
  // calls, so it's free to fully parallelize.
  const parsed: { fileName: string; text: string }[] = [];
  await Promise.all(
    files.map(async (file) => {
      if (!(file instanceof File)) return;

      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const resumeText = await extractResumeText(file.name, buffer);
        parsed.push({ fileName: file.name, text: resumeText });
      } catch (error) {
        errors.push({
          fileName: file.name,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    })
  );

  async function score(fileName: string, text: string) {
    try {
      results.push(await scoreCandidate(jobDescription, fileName, text));
    } catch (error) {
      errors.push({
        fileName,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Score the first resume alone so its call writes the job description
  // into Anthropic's prompt cache. Firing every call at once would race —
  // most would miss the cache and pay full price instead of the ~90%
  // discounted cached rate. The rest can then run in parallel against a
  // warm cache.
  const [first, ...rest] = parsed;
  if (first) await score(first.fileName, first.text);
  await Promise.all(rest.map((resume) => score(resume.fileName, resume.text)));

  results.sort((a, b) => b.score - a.score);

  return NextResponse.json({ results, errors });
}
