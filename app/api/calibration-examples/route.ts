import { NextRequest, NextResponse } from "next/server";
import { listCalibrationExamples, saveCalibrationExample } from "@/lib/calibrationExamples";
import { extractResumeText } from "@/lib/parseResume";
import { getAuthUser } from "@/lib/auth";
import type { CalibrationLabel } from "@/lib/types";

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function resolveMimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  return MIME_TYPES_BY_EXTENSION[extension] ?? "application/octet-stream";
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectIdParam = request.nextUrl.searchParams.get("projectId");
  const projectId = projectIdParam ? parseInt(projectIdParam, 10) || undefined : undefined;

  // Project-wide, not per-recruiter (2026-07-20, Vlad's ask): calibration
  // examples are meant to accumulate as real screening experience on a role
  // and benefit everyone screening that role, not just whoever happened to
  // upload them. Previously scoped by userIdFilter(user), which siloed every
  // non-admin recruiter to only their own uploads — a teammate's calibration
  // examples never reached anyone else's screenings. See scoreCandidate.ts's
  // buildCalibrationBlock() for the matching change on the scoring side.
  try {
    const examples = await listCalibrationExamples(projectId);
    return NextResponse.json({ examples });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const labelField = formData.get("label");
  const noteField = formData.get("note");
  const file = formData.get("resume");
  const projectIdField = formData.get("projectId");
  const projectId =
    typeof projectIdField === "string" && projectIdField.trim()
      ? parseInt(projectIdField.trim(), 10) || undefined
      : undefined;

  if (labelField !== "good" && labelField !== "bad") {
    return NextResponse.json({ error: 'label must be "good" or "bad"' }, { status: 400 });
  }
  const label: CalibrationLabel = labelField;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A resume file is required" }, { status: 400 });
  }

  const note = typeof noteField === "string" && noteField.trim() ? noteField.trim() : null;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const extractedText = await extractResumeText(file.name, buffer);

    const example = await saveCalibrationExample({
      label,
      note,
      fileName: file.name,
      extractedText,
      resumeFile: buffer,
      resumeMimeType: resolveMimeType(file),
      projectId,
      userId: user.id,
    });

    return NextResponse.json({ example });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
