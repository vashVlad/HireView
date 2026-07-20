import { NextRequest, NextResponse } from "next/server";
import { extractResumeText } from "@/lib/parseResume";
import { saveScreening } from "@/lib/screenings";
import { getAuthUser, userIdFilter } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import type { CandidateResult } from "@/lib/types";

export const maxDuration = 30;

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function resolveMimeType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return MIME_TYPES_BY_EXTENSION[ext] ?? "application/octet-stream";
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = userIdFilter(user);

  const formData = await request.formData();
  const resultJsonField = formData.get("resultJson");
  const resumeFile = formData.get("resumeFile");
  const jobDescriptionField = formData.get("jobDescription");
  const projectIdField = formData.get("projectId");
  const linkedInModeField = formData.get("linkedInMode");
  const agencyNameField = formData.get("agencyName");

  if (typeof resultJsonField !== "string" || !(resumeFile instanceof File) || typeof jobDescriptionField !== "string") {
    return NextResponse.json({ error: "resultJson, resumeFile, and jobDescription are required" }, { status: 400 });
  }

  let result: CandidateResult;
  try {
    result = JSON.parse(resultJsonField) as CandidateResult;
  } catch {
    return NextResponse.json({ error: "Invalid resultJson" }, { status: 400 });
  }

  const projectId = typeof projectIdField === "string" && projectIdField.trim()
    ? parseInt(projectIdField.trim(), 10) || undefined
    : undefined;
  const linkedInMode = linkedInModeField === "true";
  // DO-NOT-TOUCH EXCEPTION (2026-07-20, Vlad's ask — see decisions-log.md):
  // Agency source, same additive-metadata shape as the resumeText passthrough
  // exception right above. No scoring involvement — `result` here is already
  // fully-scored JSON passed in from the client (this route never calls
  // scoreCandidate at all).
  const agencyName = typeof agencyNameField === "string" && agencyNameField.trim() ? agencyNameField.trim() : undefined;
  const mimeType = resolveMimeType(resumeFile);

  const buffer = Buffer.from(await resumeFile.arrayBuffer());

  // Verify text is extractable before saving — and keep the result (2026-07-20
  // perf pass, DO-NOT-TOUCH EXCEPTION per this file's existing convention,
  // see decisions-log.md): this used to extract the text just to check it
  // doesn't throw, discard it, then saveScreening silently re-extracted the
  // same PDF/DOCX again internally. Passing it through below removes that
  // second, fully redundant parse — same text, zero behavior change.
  let extractedResumeText: string;
  try {
    extractedResumeText = await extractResumeText(resumeFile.name, buffer);
  } catch {
    return NextResponse.json({ error: "Could not read the resume file" }, { status: 400 });
  }

  // DO-NOT-TOUCH EXCEPTION (flagged per project convention): this file is on
  // the do-not-touch list. The only change here is looking up the project's
  // score_threshold (same pattern as app/api/screen-resumes/route.ts,
  // do-not-touch, both already do this) and passing it through to
  // saveScreening so below-threshold candidates saved via this route also
  // get auto-archived (lib/screenings.ts, 2026-07-15) — no other logic in
  // this route was touched.
  const project = projectId != null ? await getProject(projectId).catch(() => null) : null;
  const scoreThreshold = project?.scoreThreshold ?? 45;

  const { id } = await saveScreening({
    result,
    jobDescription: jobDescriptionField,
    resumeFile: buffer,
    resumeMimeType: mimeType,
    resumeText: extractedResumeText,
    linkedInMode,
    agencyName,
    projectId,
    userId,
    scoreThreshold,
  });

  return NextResponse.json({ id });
}
