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
  const crossRefScreeningIdField = formData.get("crossRefScreeningId");
  const roleContext = formData.get("roleContext");

  if (!screeningIdField || typeof screeningIdField !== "string") {
    return NextResponse.json({ error: "screeningId is required" }, { status: 400 });
  }
  const hasCrossRefDoc = crossRefDoc instanceof File;
  const hasCrossRefScreeningId = typeof crossRefScreeningIdField === "string" && crossRefScreeningIdField.trim().length > 0;
  if (!hasCrossRefDoc && !hasCrossRefScreeningId) {
    return NextResponse.json({ error: "Provide a cross-reference document (PDF or Word) or an existing candidate to compare against." }, { status: 400 });
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

  if (hasCrossRefScreeningId) {
    // Candidate-vs-candidate comparison (e.g. two screenings that happened to
    // share a filename — see ResultCard.tsx's "Compare" on the filename-match
    // banner). Both sides are already-saved screenings, so pull the other
    // one's resume straight from storage instead of asking for a re-upload.
    // Deliberately doesn't touch crossRefPath/linkedInPdfPath below — there's
    // no new external document here, just an internal comparison, and the
    // other screening's own resume_path already points at its file.
    const crossRefScreeningId = parseInt(crossRefScreeningIdField as string, 10);
    if (isNaN(crossRefScreeningId)) {
      return NextResponse.json({ error: "Invalid crossRefScreeningId" }, { status: 400 });
    }
    const crossRefData = await getScreeningResume(crossRefScreeningId);
    if (!crossRefData) {
      return NextResponse.json({ error: "Cross-reference screening record not found" }, { status: 404 });
    }
    try {
      crossRefText = await extractResumeText(crossRefData.fileName, crossRefData.data);
    } catch {
      return NextResponse.json({ error: "Could not extract text from the cross-reference candidate's resume" }, { status: 500 });
    }
  } else {
    const doc = crossRefDoc as File;
    try {
      const buffer = Buffer.from(await doc.arrayBuffer());
      crossRefText = await extractResumeText(doc.name, buffer);

      // Store the cross-reference doc in Supabase Storage for the Interview View
      const ext = doc.name.split(".").pop()?.toLowerCase() ?? "pdf";
      const contentType = ext === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf";
      const supabase = getSupabaseClient();
      const path = `linkedin_pdfs/${randomUUID()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from(RESUME_BUCKET)
        .upload(path, buffer, { contentType, upsert: true });
      if (!uploadErr) {
        crossRefPath = path;
      } else {
        // Previously swallowed silently — the credibility check would still
        // succeed and show results, giving no indication the doc never made
        // it into storage, so it just wouldn't show up later in Interview
        // View with no visible error anywhere. Log it so this is diagnosable.
        console.error("Failed to store cross-reference doc for Interview View:", uploadErr);
      }
    } catch {
      return NextResponse.json({ error: "Could not extract text from cross-reference document" }, { status: 400 });
    }
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