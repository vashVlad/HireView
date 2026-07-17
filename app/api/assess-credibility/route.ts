import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { assessCredibility, detectLinkedIn } from "@/lib/assessCredibility";
import { extractResumeText } from "@/lib/parseResume";
import { getScreeningResume, updateScreening } from "@/lib/screenings";
import { getSupabaseClient, RESUME_BUCKET } from "@/lib/supabase";
import { canAccessScreening, getAuthUser } from "@/lib/auth";

export const maxDuration = 60;

// Perf pass, 2026-07-15 — carries a ready-made NextResponse through
// Promise.all so the two independent fetch+extract branches below (main
// resume vs. cross-reference doc/screening) can run concurrently instead of
// sequentially, while every existing error status/message stays exactly
// where it was in the original sequential version.
class RouteError extends Error {
  constructor(public response: NextResponse) {
    super("RouteError");
  }
}

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

  // Team-scoping check, added in the 2026-07-16 audit — this route had zero
  // auth check at all before, letting anyone run a credibility comparison
  // against any two screenings regardless of team. Both sides need checking:
  // the main screening always, and the cross-reference screening too when
  // this is a candidate-vs-candidate comparison (not a freshly uploaded doc).
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessScreening(user, screeningId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (hasCrossRefScreeningId) {
    const crossRefScreeningId = parseInt(crossRefScreeningIdField as string, 10);
    if (!isNaN(crossRefScreeningId) && !(await canAccessScreening(user, crossRefScreeningId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Perf pass, 2026-07-15: the main resume and the cross-reference doc are
  // fetched from two unrelated sources (Supabase storage vs. an uploaded
  // File, or two independent Supabase rows in the screening-vs-screening
  // case) and extracted independently — there was never a data dependency
  // between them, they just ran one after the other. Running them via
  // Promise.all instead cuts this route's fetch+extract time roughly to
  // whichever side is slower, instead of the sum of both. Every error
  // status/message below is unchanged from the sequential version — each
  // branch throws a RouteError carrying the exact same NextResponse it used
  // to `return` directly.

  async function loadMainResume(): Promise<string> {
    // Fetch the original resume from Supabase storage — no re-upload needed
    const resumeData = await getScreeningResume(screeningId);
    if (!resumeData) {
      throw new RouteError(NextResponse.json({ error: "Screening record not found" }, { status: 404 }));
    }
    try {
      return await extractResumeText(resumeData.fileName, resumeData.data);
    } catch {
      throw new RouteError(NextResponse.json({ error: "Could not extract text from original resume" }, { status: 500 }));
    }
  }

  async function loadCrossRef(): Promise<{ crossRefText: string; crossRefPath?: string }> {
    if (hasCrossRefScreeningId) {
      // Candidate-vs-candidate comparison (e.g. two screenings that happened
      // to share a filename — see ResultCard.tsx's "Compare" on the
      // filename-match banner). Both sides are already-saved screenings, so
      // pull the other one's resume straight from storage instead of asking
      // for a re-upload. Deliberately doesn't set crossRefPath below —
      // there's no new external document here, just an internal comparison,
      // and the other screening's own resume_path already points at its file.
      const crossRefScreeningId = parseInt(crossRefScreeningIdField as string, 10);
      if (isNaN(crossRefScreeningId)) {
        throw new RouteError(NextResponse.json({ error: "Invalid crossRefScreeningId" }, { status: 400 }));
      }
      const crossRefData = await getScreeningResume(crossRefScreeningId);
      if (!crossRefData) {
        throw new RouteError(NextResponse.json({ error: "Cross-reference screening record not found" }, { status: 404 }));
      }
      try {
        return { crossRefText: await extractResumeText(crossRefData.fileName, crossRefData.data) };
      } catch {
        throw new RouteError(NextResponse.json({ error: "Could not extract text from the cross-reference candidate's resume" }, { status: 500 }));
      }
    }

    const doc = crossRefDoc as File;
    try {
      const buffer = Buffer.from(await doc.arrayBuffer());
      const crossRefText = await extractResumeText(doc.name, buffer);

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
        return { crossRefText, crossRefPath: path };
      }
      // Previously swallowed silently — the credibility check would still
      // succeed and show results, giving no indication the doc never made
      // it into storage, so it just wouldn't show up later in Interview
      // View with no visible error anywhere. Log it so this is diagnosable.
      console.error("Failed to store cross-reference doc for Interview View:", uploadErr);
      return { crossRefText };
    } catch {
      throw new RouteError(NextResponse.json({ error: "Could not extract text from cross-reference document" }, { status: 400 }));
    }
  }

  let resumeText: string;
  let crossRefText: string;
  let crossRefPath: string | undefined;
  try {
    const [main, crossRef] = await Promise.all([loadMainResume(), loadCrossRef()]);
    resumeText = main;
    crossRefText = crossRef.crossRefText;
    crossRefPath = crossRef.crossRefPath;
  } catch (err) {
    if (err instanceof RouteError) return err.response;
    throw err;
  }

  // Phase 2.4: LinkedIn-specific prompting. Only meaningful for an uploaded
  // file — candidate-vs-candidate comparisons (crossRefScreeningId mode) are
  // always resume-vs-resume, never LinkedIn, so skip detection there.
  const isLinkedIn = hasCrossRefDoc ? detectLinkedIn(crossRefText) : false;

  const assessment = await assessCredibility({
    resumeText,
    crossRefText,
    roleContext: typeof roleContext === "string" ? roleContext : undefined,
    isLinkedIn,
  });

  // Persist cross-reference doc path (reuses linkedin_pdf_path column — no schema change)
  if (crossRefPath) {
    await updateScreening(screeningId, { linkedInPdfPath: crossRefPath }).catch(() => {});
  }

  return NextResponse.json({ assessment });
}