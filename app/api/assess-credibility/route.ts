import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { assessCredibility } from "@/lib/assessCredibility";
import { extractResumeText } from "@/lib/parseResume";
import { getScreeningResume, updateScreening } from "@/lib/screenings";
import { getSupabaseClient, RESUME_BUCKET } from "@/lib/supabase";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const formData = await request.formData();

  const screeningIdField = formData.get("screeningId");
  const crossRefDoc = formData.get("crossRefDoc");
  const roleContext = formData.get("roleContext");

  if (!screeningIdField || typeof screeningIdField !== "string") {
    return NextResponse.json({ error: "screeningId is required" }, { status: 400 });
  }
  if (!(crossRefDoc instanceof File)) {
    return NextResponse.json({ error: "Provide a cross-reference document (PDF or Word)." }, { status: 400 });
  }

  const screeningId = parseInt(screeningIdField, 10);
  if (isNaN(screeningId)) {
    return NextResponse.json({ error: "Invalid screeningId" }, { status: 400 });
  }

  // Fetch the original resume from Supabase storage — no re-upload needed
  const resumeData = await getScreeningResume(screeningId);
  if (!resumeData) {
    return NextResponse.json({ error: "Screening record not found" }, { status: 404 });
  }

  let resumeText: string;
  try {
    resumeText = await extractResumeText(resumeData.fileName, resumeData.data);
  } catch {
    return NextResponse.json({ error: "Could not extract text from original resume" }, { status: 500 });
  }

  let crossRefText: string;
  let crossRefPath: string | undefined;
  try {
    const buffer = Buffer.from(await crossRefDoc.arrayBuffer());
    crossRefText = await extractResumeText(crossRefDoc.name, buffer);

    // Store the cross-reference doc in Supabase Storage for the Interview View
    const ext = crossRefDoc.name.split(".").pop()?.toLowerCase() ?? "pdf";
    const contentType = ext === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/pdf";
    const supabase = getSupabaseClient();
    const path = `linkedin_pdfs/${randomUUID()}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from(RESUME_BUCKET)
      .upload(path, buffer, { contentType, upsert: true });
    if (!uploadErr) crossRefPath = path;
  } catch {
    return NextResponse.json({ error: "Could not extract text from cross-reference document" }, { status: 400 });
  }

  const assessment = await assessCredibility({
    resumeText,
    crossRefText,
    roleContext: typeof roleContext === "string" ? roleContext : undefined,
  });

  // Persist cross-reference doc path (reuses linkedin_pdf_path column — no schema change)
  if (crossRefPath) {
    await updateScreening(screeningId, { linkedInPdfPath: crossRefPath }).catch(() => {});
  }

  return NextResponse.json({ assessment });
}