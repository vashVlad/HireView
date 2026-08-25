import { NextRequest, NextResponse } from "next/server";
import { extractResumeText } from "@/lib/parseResume";
import { generateFingerprint } from "@/lib/generateFingerprint";
import { saveScreening } from "@/lib/screenings";
import { canAccessProject, getAuthUser, userIdFilter } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { DEFAULT_SCORE_THRESHOLD } from "@/lib/scoreThreshold";
import type { CandidateResult } from "@/lib/types";

// DO-NOT-TOUCH EXCEPTION (2026-07-30 — Vlad reported a real
// FUNCTION_INVOCATION_TIMEOUT on this exact route, transferring a candidate
// from a Cross-Project Fit Suggestion during screening). Same root-cause
// class already fixed in app/api/screen-resumes/route.ts on 2026-07-29 (see
// that file's own do-not-touch exception): saveScreening() calls
// generateFingerprint(), a real Claude API call, and this route let it run
// sequentially — after the project lookup, storage upload, insert, and
// activity log write — instead of overlapping it with independent work.
// Raised from 30 to 300 here too, matching screen-resumes/route.ts exactly
// (that file's comment documents the Vercel plan caveat — 300 only deploys
// cleanly on Pro/Enterprise or Hobby+Fluid Compute — already proven safe on
// this project's plan since screen-resumes/route.ts deploys fine with the
// same value). See the fingerprint-parallelization exception further down
// for the other half of this fix.
export const maxDuration = 300;

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
  // DO-NOT-TOUCH EXCEPTION (2026-07-21 — see decisions-log.md, same fix and
  // reasoning as app/api/screen-resumes/route.ts): this route trusted a
  // client-supplied projectId to pull the project's score threshold and to
  // tag the saved screening's team_id, with no check that the requester's
  // team owns that project. Additive only — skipped when no projectId is
  // supplied, otherwise 403 via the existing canAccessProject helper.
  if (projectId && !(await canAccessProject(user, projectId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
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
  // get auto-archived (lib/screenings.ts, 2026-07-15).
  //
  // DO-NOT-TOUCH EXCEPTION (2026-07-30 — see this file's maxDuration comment
  // above for the full timeout root-cause). generateFingerprint() only needs
  // extractedResumeText, already resolved above — it doesn't depend on this
  // project lookup at all, so there's no reason to make it wait. Run in
  // parallel via Promise.all and pass the result through saveScreening's
  // existing `fingerprint` param (already supports this — screen-resumes/
  // route.ts does the exact same thing to overlap fingerprinting with its
  // own scoreCandidate() call; this route has no scoring call to hide it
  // under, so it overlaps with the project lookup instead). Zero changes to
  // lib/screenings.ts itself. Explicit `null` on failure (not just omitting
  // the field) tells saveScreening not to retry — same fail-open contract
  // screen-resumes already relies on; a fingerprinting failure here still
  // can never block the transfer from saving, it just skips duplicate/
  // history matching for this one save.
  const [project, fingerprint] = await Promise.all([
    projectId != null ? getProject(projectId).catch(() => null) : Promise.resolve(null),
    generateFingerprint(extractedResumeText).catch((err) => {
      console.error("Fingerprint generation failed (screening still saved, duplicate/history matching skipped):", err);
      return null;
    }),
  ]);
  // DO-NOT-TOUCH EXCEPTION (2026-08-20 — Claude Code's full-system audit
  // flagged this literal `45` fallback as one of 9 hardcoded copies of the
  // same default across the app, a real drift risk since nothing tied them
  // together; see lib/scoreThreshold.ts's own doc comment). Same value,
  // same fallback behavior — just sourced from one shared constant instead
  // of retyping the number here.
  const scoreThreshold = project?.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;

  // DO-NOT-TOUCH EXCEPTION (2026-08-25 — Vlad's ask: "check the code for
  // more errors like that," after finding and fixing the same class of bug
  // in app/api/cross-project-fit/route.ts). saveScreening() throws raw on
  // its main `screenings` insert failing (lib/screenings.ts) and nothing in
  // this route caught that — a transient DB hiccup fell through to Next.js's
  // bodyless default 500 instead of a diagnosable message. Minimal, targeted
  // wrap of only this one call (not the whole handler) to keep the diff on
  // this do-not-touch file as small as possible — every other call above
  // already has its own guard (try/catch or .catch()).
  let id: number;
  try {
    ({ id } = await saveScreening({
      result,
      jobDescription: jobDescriptionField,
      resumeFile: buffer,
      resumeMimeType: mimeType,
      resumeText: extractedResumeText,
      fingerprint,
      linkedInMode,
      agencyName,
      projectId,
      userId,
      scoreThreshold,
    }));
  } catch (err) {
    console.error("saveScreening failed in save-one route:", err);
    return NextResponse.json({ error: "Could not save the screening — see server logs for the real cause" }, { status: 500 });
  }

  return NextResponse.json({ id });
}
