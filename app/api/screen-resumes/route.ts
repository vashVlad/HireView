import { NextRequest, NextResponse } from "next/server";
import { listCalibrationExamples } from "@/lib/calibrationExamples";
import { extractResumeText } from "@/lib/parseResume";
import { scoreCandidate } from "@/lib/scoreCandidate";
import { saveScreening } from "@/lib/screenings";
import type { CandidateResult, ScreenResumesError } from "@/lib/types";

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function resolveMimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  return MIME_TYPES_BY_EXTENSION[extension] ?? "application/octet-stream";
}

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

  // Best-effort: a calibration library issue shouldn't block screening.
  const calibrationExamples = await listCalibrationExamples().catch(() => []);

  // Extract text for every resume first — this is local parsing, no API
  // calls, so it's free to fully parallelize.
  const parsed: { fileName: string; text: string; buffer: Buffer; mimeType: string }[] = [];
  await Promise.all(
    files.map(async (file) => {
      if (!(file instanceof File)) return;

      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const resumeText = await extractResumeText(file.name, buffer);
        parsed.push({
          fileName: file.name,
          text: resumeText,
          buffer,
          mimeType: resolveMimeType(file),
        });
      } catch (error) {
        errors.push({
          fileName: file.name,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    })
  );

  async function score(resume: (typeof parsed)[number]) {
    try {
      const result = await scoreCandidate(
        jobDescription,
        resume.fileName,
        resume.text,
        calibrationExamples
      );
      results.push(result);

      // Only persist candidates worth revisiting. Scores under 30 are
      // clear mismatches — saving them would pollute history without value.
      if (result.score >= 30) {
        // Awaited (not fire-and-forget): Vercel can freeze the function as
        // soon as the response is sent, which would silently drop an
        // un-awaited write.
        try {
          const { id } = await saveScreening({
            result,
            jobDescription,
            resumeFile: resume.buffer,
            resumeMimeType: resume.mimeType,
          });
          result.id = id;
          result.status = "new_applicant";
        } catch (error) {
          console.error("Failed to save screening history:", error);
        }
      }
    } catch (error) {
      errors.push({
        fileName: resume.fileName,
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
  if (first) await score(first);
  await Promise.all(rest.map((resume) => score(resume)));

  results.sort((a, b) => b.score - a.score);

  return NextResponse.json({ results, errors });
}
