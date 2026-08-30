import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { assessCredibility, detectLinkedIn } from "@/lib/assessCredibility";
import { extractResumeText } from "@/lib/parseResume";
import { getScreeningConcerns, getScreeningNarrativeContext, getScreeningResume, getScreeningTrajectoryEntries, updateScreening } from "@/lib/screenings";
import { getSupabaseClient, RESUME_BUCKET } from "@/lib/supabase";
import { canAccessScreening, getAuthUser } from "@/lib/auth";
import { extractGithubUsername, fetchGithubCorroboration } from "@/lib/githubCorroboration";

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
    } catch (err) {
      // 2026-08-03 — surface the underlying reason (e.g. parseResume.ts's new
      // "little to no text" .docx message) instead of a generic string, so a
      // real extraction failure reads as an actionable error in the UI rather
      // than a vague one. Falls back to the old generic message if the
      // thrown error has none.
      const message = err instanceof Error && err.message ? err.message : "Could not extract text from original resume";
      throw new RouteError(NextResponse.json({ error: message }, { status: 500 }));
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
      } catch (err) {
        const message = err instanceof Error && err.message
          ? err.message
          : "Could not extract text from the cross-reference candidate's resume";
        throw new RouteError(NextResponse.json({ error: message }, { status: 500 }));
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
    } catch (err) {
      const message = err instanceof Error && err.message
        ? err.message
        : "Could not extract text from cross-reference document";
      throw new RouteError(NextResponse.json({ error: message }, { status: 400 }));
    }
  }

  let resumeText: string;
  let crossRefText: string;
  let crossRefPath: string | undefined;
  let originalConcerns: string[];
  let candidateTrajectoryEntries: Awaited<ReturnType<typeof getScreeningTrajectoryEntries>>;
  let narrativeContext: Awaited<ReturnType<typeof getScreeningNarrativeContext>>;
  try {
    // originalConcerns (added 2026-07-29, positive-scoring feature) is an
    // independent read, same reasoning as the main-resume/cross-ref split
    // above — folded into the same Promise.all rather than awaited after,
    // and never allowed to fail the whole request (see getScreeningConcerns'
    // own comment: fails closed to [], not thrown). candidateTrajectoryEntries
    // (roadmap 2.5.2, 2026-08-17) is the same shape of independent, never-
    // fails-the-request read — getScreeningTrajectoryEntries fails closed to
    // null (not thrown), which assessCredibility() reads as "fall back to
    // the legacy single-call comparison," never as a request failure.
    const [main, crossRef, concerns, trajectoryEntries, narrative] = await Promise.all([
      loadMainResume(),
      loadCrossRef(),
      getScreeningConcerns(screeningId),
      getScreeningTrajectoryEntries(screeningId),
      getScreeningNarrativeContext(screeningId),
    ]);
    resumeText = main;
    crossRefText = crossRef.crossRefText;
    crossRefPath = crossRef.crossRefPath;
    originalConcerns = concerns;
    candidateTrajectoryEntries = trajectoryEntries;
    narrativeContext = narrative;
  } catch (err) {
    if (err instanceof RouteError) return err.response;
    throw err;
  }

  // Phase 2.4: LinkedIn-specific prompting. Only meaningful for an uploaded
  // file — candidate-vs-candidate comparisons (crossRefScreeningId mode) are
  // always resume-vs-resume, never LinkedIn, so skip detection there.
  const isLinkedIn = hasCrossRefDoc ? detectLinkedIn(crossRefText) : false;

  // GitHub corroboration, 2026-08-17 (roadmap 2.5.3) — deliberately run and
  // attached AFTER assessCredibility() returns, not fed into its prompt.
  // See lib/githubCorroboration.ts's header comment for the full reasoning:
  // assessCredibility.ts's prompt is a tuned, live-calibrated system this
  // sandbox can't test against, so this stays a pure code-side passthrough
  // rather than risking a regression to it. Best-effort end to end — a
  // missing/failed lookup just means no panel shows, same as no cross-ref
  // doc at all; never blocks or slows the real credibility check
  // meaningfully (5s timeout, and only even attempted when a GitHub URL is
  // actually present in the resume text).
  const githubUsername = extractGithubUsername(resumeText);
  const githubSignal = githubUsername
    ? await fetchGithubCorroboration(githubUsername).catch(() => null)
    : null;

  // Real error handling, 2026-08-25 — assessCredibility() makes a raw
  // Anthropic call with no internal try/catch of its own, and unlike the
  // earlier Promise.all block above (wrapped via the RouteError pattern),
  // nothing here caught a failure from it — an API error, rate limit, or
  // malformed response fell through to Next.js's bodyless default 500
  // instead of a diagnosable message.
  let assessment: Awaited<ReturnType<typeof assessCredibility>>;
  try {
    assessment = await assessCredibility({
      resumeText,
      crossRefText,
      roleContext: typeof roleContext === "string" ? roleContext : undefined,
      isLinkedIn,
      originalConcerns,
      // undefined (not null) matches assessCredibility()'s param type — null
      // here just means "no stored trajectory yet," same "fall back to legacy
      // flow" outcome as undefined, so the conversion is purely a type nicety.
      candidateTrajectoryEntries: candidateTrajectoryEntries ?? undefined,
      careerTrajectory: narrativeContext.careerTrajectory,
      totalExperienceSummary: narrativeContext.totalExperienceSummary,
    });
  } catch (err) {
    console.error("Credibility assessment failed:", err);
    return NextResponse.json({ error: "Could not complete the credibility check — see server logs for the real cause" }, { status: 500 });
  }
  if (githubSignal) {
    assessment.githubSignal = githubSignal;
  }

  // Persist cross-reference doc path (reuses linkedin_pdf_path column — no schema change)
  if (crossRefPath) {
    await updateScreening(screeningId, { linkedInPdfPath: crossRefPath }).catch(() => {});
    // Separate, independent call — deliberately NOT merged into the update
    // above. cross_ref_is_linkedin requires its own migration
    // (supabase-migration-cross-ref-doc-type.sql, NOT YET CONFIRMED RUN as of
    // this comment); keeping it as its own UPDATE means a missing column
    // here can never fail/roll back persisting linkedInPdfPath, which already
    // worked before this column existed. Lets the Interview View document
    // popup label the second tab correctly ("LinkedIn" vs "Cross-Reference")
    // instead of always assuming LinkedIn.
    await updateScreening(screeningId, { crossRefIsLinkedIn: isLinkedIn }).catch(() => {});
  }

  return NextResponse.json({ assessment });
}