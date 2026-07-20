import { NextRequest, NextResponse } from "next/server";
import { listCalibrationExamples } from "@/lib/calibrationExamples";
import { extractResumeText } from "@/lib/parseResume";
import { scoreCandidate } from "@/lib/scoreCandidate";
import { generateFingerprint } from "@/lib/generateFingerprint";
import { saveScreening } from "@/lib/screenings";
import { saveScreeningBatch } from "@/lib/screeningBatches";
import { getProject } from "@/lib/projects";
import { getAuthUser, userIdFilter } from "@/lib/auth";
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
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = userIdFilter(user);

  const formData = await request.formData();
  const jobDescriptionField = formData.get("jobDescription");
  const jdFileField = formData.get("jdFile");
  const files = formData.getAll("resumes");
  const projectIdField = formData.get("projectId");
  const projectId = typeof projectIdField === "string" && projectIdField.trim()
    ? parseInt(projectIdField.trim(), 10) || undefined
    : undefined;
  const linkedInModeOverride = formData.get("linkedInMode") === "true";

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

  // Pull project config (LinkedIn context + per-role score threshold)
  let linkedInContext: string | undefined;
  let scoreThreshold = 45;
  if (projectId) {
    const project = await getProject(projectId).catch(() => null);
    linkedInContext = project?.jdAnalysis?.linkedInContext ?? undefined;
    scoreThreshold = project?.scoreThreshold ?? 45;
  }

  if (files.length === 0) {
    return NextResponse.json(
      { error: "At least one resume file is required" },
      { status: 400 }
    );
  }

  const results: CandidateResult[] = [];
  const errors: ScreenResumesError[] = [];

  // Best-effort: a calibration library issue shouldn't block screening.
  // Scoped to the current project so examples from other projects don't bleed
  // in — deliberately NOT scoped to userId (2026-07-20, Vlad's explicit ask,
  // do-not-touch exception, see memory/decisions-log.md): calibration
  // examples should accumulate project-wide as real screening experience and
  // benefit every recruiter working this role, not just whoever uploaded
  // them. Matching change on the display side in
  // app/api/calibration-examples/route.ts's GET handler.
  const calibrationExamples = await listCalibrationExamples(projectId).catch(() => []);

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
      // DO-NOT-TOUCH EXCEPTION (flagged, 2026-07-20 perf pass — see
      // decisions-log.md): fingerprinting (fraud/duplicate detection) only
      // needs the raw resume text, not the score, so it never actually had to
      // wait for scoring to finish — it was just written sequentially before.
      // Running both Claude calls concurrently cuts the wait to roughly
      // whichever one is slower instead of the sum of both, with no change to
      // what either call does or what the response contains. A fingerprint
      // failure resolves to `null` (not a rejection) so it can never fail the
      // scoring half of this Promise.all — saveScreening treats an explicit
      // `null` as "don't retry, just skip duplicate/history matching for this
      // save," same as its pre-existing best-effort behavior.
      const [result, fingerprint] = await Promise.all([
        scoreCandidate(
          jobDescription,
          resume.fileName,
          resume.text,
          calibrationExamples,
          roleContext,
          linkedInContext,
          linkedInModeOverride
        ),
        generateFingerprint(resume.text).catch((err) => {
          console.error("Fingerprint generation failed (scoring unaffected):", err);
          return null;
        }),
      ]);
      results.push(result);

      // Persist every screened candidate, regardless of score (Teti's
      // request, 2026-07-10 — no candidate should be lost, including
      // below-threshold ones, so rejection history is visible later).
      // scoreThreshold now ALSO gates the initial status (see saveScreening's
      // auto-archive logic, lib/screenings.ts, 2026-07-15) in addition to the
      // cross-project fit suggestion — below-threshold candidates still get
      // saved, just straight into "archived" instead of "new_applicant".
      //
      // DO-NOT-TOUCH EXCEPTION (flagged per project convention): this file is
      // on the do-not-touch list. The only change here is adding the
      // already-locally-available `scoreThreshold` (computed above) to this
      // existing saveScreening call — no other logic in this route was touched.
      //
      // Awaited (not fire-and-forget): Vercel can freeze the function as
      // soon as the response is sent, which would silently drop an
      // un-awaited write.
      try {
        // DO-NOT-TOUCH EXCEPTION (flagged, 2026-07-20 perf pass — see
        // decisions-log.md): passes the resume text already extracted above
        // (in `parsed`, for scoring) through to saveScreening instead of
        // letting it silently re-extract the same PDF/DOCX a second time
        // internally. Same text, zero behavior change — pure perf.
        const { id } = await saveScreening({
          result,
          jobDescription,
          resumeFile: resume.buffer,
          resumeMimeType: resume.mimeType,
          resumeText: resume.text,
          fingerprint,
          linkedInMode: linkedInModeOverride,
          projectId,
          userId,
          scoreThreshold,
        });
        result.id = id;
      } catch (err) {
        console.error("Failed to persist screening result:", err);
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

  // Save aggregate batch stats for analytics — includes ALL scores (even rejected ones).
  // Fire-and-forget: a stats write failure should never block the response.
  if (results.length > 0) {
    const passedCount = results.filter((r) => r.score >= scoreThreshold).length;
    saveScreeningBatch({
      userId,
      projectId,
      scores: results.map((r) => r.score),
      passedCount,
    }).catch((err) => console.error("Failed to save screening batch:", err));
  }

  results.sort((a, b) => b.score - a.score);

  return NextResponse.json({ results, errors });
}
