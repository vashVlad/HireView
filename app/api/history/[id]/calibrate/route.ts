import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getSupabaseClient, RESUME_BUCKET } from "@/lib/supabase";
import { saveCalibrationExample } from "@/lib/calibrationExamples";
import { extractResumeText } from "@/lib/parseResume";
import type { CalibrationLabel } from "@/lib/types";

/**
 * POST /api/history/[id]/calibrate
 * Marks a screened candidate as a calibration example (good or bad).
 * Body: { label: "good" | "bad", note?: string }
 *
 * Downloads the candidate's resume from storage, re-extracts the text,
 * and saves a new calibration_examples record so it feeds future screenings.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const label: CalibrationLabel = body?.label === "bad" ? "bad" : "good";
  const note: string | null = body?.note?.trim() || null;

  const supabase = getSupabaseClient();

  // Fetch the screening to get resume info
  const { data: row, error: rowErr } = await supabase
    .from("screenings")
    .select("resume_path, resume_mime_type, file_name, project_id")
    .eq("id", numId)
    .single<{
      resume_path: string;
      resume_mime_type: string;
      file_name: string;
      project_id: number | null;
    }>();

  if (rowErr || !row) {
    return NextResponse.json({ error: "Screening not found" }, { status: 404 });
  }

  // Download the resume from storage
  const { data: blob, error: dlErr } = await supabase.storage
    .from(RESUME_BUCKET)
    .download(row.resume_path);
  if (dlErr || !blob) {
    return NextResponse.json({ error: "Could not retrieve resume file" }, { status: 500 });
  }

  const buffer = Buffer.from(await blob.arrayBuffer());

  // Extract text (same as the original screening did)
  let extractedText: string;
  try {
    extractedText = await extractResumeText(row.file_name, buffer);
  } catch {
    return NextResponse.json({ error: "Could not extract resume text" }, { status: 500 });
  }

  // Save as a calibration example
  try {
    const example = await saveCalibrationExample({
      label,
      note,
      fileName: row.file_name,
      extractedText,
      resumeFile: buffer,
      resumeMimeType: row.resume_mime_type,
      projectId: row.project_id ?? undefined,
      userId: user.id,
    });
    return NextResponse.json({ example });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save calibration example" },
      { status: 500 }
    );
  }
}
