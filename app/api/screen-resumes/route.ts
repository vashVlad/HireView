import { NextRequest, NextResponse } from "next/server";
import { listCalibrationExamples } from "@/lib/calibrationExamples";
import { extractResumeText } from "@/lib/parseResume";
import { scoreCandidate } from "@/lib/scoreCandidate";
import { saveScreening } from "@/lib/screenings";
import type { CandidateResult, ScreenResumesError } from "@/lib/types";

export const maxDuration = 60;

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
  const jdFileField = formData.get("jdFile");
  const files = formData.getAll("resumes");
  const projectIdField = formData.get("projectId");
  const projectId = typeof projectIdField === "string" && projectIdField.trim()
    ? parseInt(projectIdField.trim(), 10) || undefined
    : undefined;

  let jobDescription: string;

  if (jdFileField instanceof File) {
    try {
      const buffer = Buffer.from(await jdFileField.arrayBuffer());
      jobDescription = await extractResumeText(jdFileField.name, buffer);
    } catch {
      return NextResponse.json(
        { error: `Could not read job description file: ${jdFileField.name}` },
        { status: 400 }
      );
    }
  } else if (typeof jobDescriptionField === "string" && jobDescriptionField.trim()) {
    jobDescription = jobDescriptionField;
  } else {
    return NextResponse.json(
      { error: "Provide a job description — either paste text or upload a file." },
      { status: 400 }
    );
  }

  // First non-empty line of the JD gives Claude a concise role label
  const roleContext = jobDescription
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);

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
        calibrationExamples,
        roleContext
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
            projectId,
          });
          result.id = id;
        } catch (err) {
          console.error("Failed to persist screening result:", err);
        }
      }
    } catch (error) {
      errors.push({
        fileName: resume.fileName,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Score up to 3 resumes concurrently to stay within Anthropic rate limits
  // while still being meaningfully faster than sequential processing.
  const CONCURRENCY = 3;
  for (let i = 0; i < parsed.length; i += CONCURRENCY) {
    await Promise.all(parsed.slice(i, i + CONCURRENCY).map(score));
  }

  results.sort((a, b) => b.score - a.score);

  return NextResponse.json({ results, errors });
}
