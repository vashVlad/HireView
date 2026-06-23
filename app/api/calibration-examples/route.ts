import { NextRequest, NextResponse } from "next/server";
import { listCalibrationExamples, saveCalibrationExample } from "@/lib/calibrationExamples";
import { extractResumeText } from "@/lib/parseResume";
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

export async function GET() {
  try {
    const examples = await listCalibrationExamples();
    return NextResponse.json({ examples });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const labelField = formData.get("label");
  const noteField = formData.get("note");
  const file = formData.get("resume");

  if (labelField !== "good" && labelField !== "bad") {
    return NextResponse.json({ error: "label must be \"good\" or \"bad\"" }, { status: 400 });
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
    });

    return NextResponse.json({ example });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
