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
  const linkedInFile = formData.get("linkedInPdf");
  const secondResumeFile = formData.get("secondResume");
  const roleContext = formData.get("roleContext");

  if (!screeningIdField || typeof screeningIdField !== "string") {
    return NextResponse.json({ error: "screeningId is required" }, { status: 400 });
  }
  if (!(linkedInFile instanceof File) && !(secondResumeFile instanceof File)) {
    return NextResponse.json({ error: "Provide a LinkedIn PDF, a second resume, or both." }, { status: 400 });
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

  let linkedInText: string | undefined;
  let linkedInPdfPath: string | undefined;
  if (linkedInFile instanceof File) {
    try {
      const buffer = Buffer.from(await linkedInFile.arrayBuffer());
      linkedInText = await extractResumeText(linkedInFile.name, buffer);

      // Store the LinkedIn PDF in Supabase Storage for the Interview View toggle
      const supabase = getSupabaseClient();
      const path = `linkedin_pdfs/${randomUUID()}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from(RESUME_BUCKET)
        .upload(path, buffer, { contentType: "application/pdf", upsert: true });
      if (!uploadErr) linkedInPdfPath = path;
    } catch {
      return NextResponse.json({ error: "Could not extract text from LinkedIn PDF" }, { status: 400 });
    }
  }

  let secondResumeText: string | undefined;
  if (secondResumeFile instanceof File) {
    try {
      const buffer = Buffer.from(await secondResumeFile.arrayBuffer());
      secondResumeText = await extractResumeText(secondResumeFile.name, buffer);
    } catch {
      return NextResponse.json({ error: "Could not extract text from second resume" }, { status: 400 });
    }
  }

  const assessment = await assessCredibility({
    resumeText,
    linkedInText,
    secondResumeText,
    roleContext: typeof roleContext === "string" ? roleContext : undefined,
  });

  // Persist LinkedIn PDF path if we stored one
  if (linkedInPdfPath) {
    await updateScreening(screeningId, { linkedInPdfPath }).catch(() => {});
  }

  return NextResponse.json({ assessment });
}
