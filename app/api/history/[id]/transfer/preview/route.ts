import { NextRequest, NextResponse } from "next/server";
import { getScreeningsByIds, getScreeningResume } from "@/lib/screenings";
import { getProject } from "@/lib/projects";
import { listCalibrationExamples } from "@/lib/calibrationExamples";
import { extractResumeText } from "@/lib/parseResume";
import { scoreCandidate } from "@/lib/scoreCandidate";
import { canAccessScreening, canAccessProject, getAuthUser } from "@/lib/auth";
import { errorMessage } from "@/lib/errorMessage";

export const maxDuration = 60;

/**
 * Step 2 of the redesigned Transfer flow (Vlad's ask, 2026-07-29) — only
 * called when a recruiter flips TransferControl's "Screen for this project
 * now" toggle on, after /transfer/precheck already confirmed the candidate
 * has no existing screening in the destination project. Runs a REAL
 * scoreCandidate call against the destination project's own JD and
 * calibration library — same pattern as
 * app/api/history/[id]/rescreen/route.ts, just scoring against a different
 * project's JD instead of this screening's own project — but deliberately
 * does NOT save anything. The recruiter sees the resulting score in the
 * popover first; only a subsequent POST to /transfer (mode: "rescore",
 * carrying this exact result back) actually persists a new screening row.
 * This avoids ever scoring the same resume twice for one transfer.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const screeningId = parseInt(id, 10);
  if (isNaN(screeningId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const destinationProjectId = typeof body?.projectId === "number" ? body.projectId : NaN;
  if (isNaN(destinationProjectId)) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessScreening(user, screeningId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await canAccessProject(user, destinationProjectId))) {
    return NextResponse.json({ error: "Forbidden — you don't have access to that project" }, { status: 403 });
  }

  try {
    const [screening] = await getScreeningsByIds([screeningId]);
    if (!screening) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const destinationProject = await getProject(destinationProjectId);
    if (!destinationProject) return NextResponse.json({ error: "Destination project not found" }, { status: 404 });

    const resume = await getScreeningResume(screeningId);
    const resumeText = await extractResumeText(resume.fileName, resume.data);

    // Same derivation as app/api/screen-resumes/route.ts (do-not-touch) —
    // first non-empty line of the destination JD as a concise role label.
    const roleContext = destinationProject.jobDescription
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0);

    const calibrationExamples = await listCalibrationExamples(destinationProject.id).catch(() => []);

    const result = await scoreCandidate(
      destinationProject.jobDescription,
      resume.fileName,
      resumeText,
      calibrationExamples,
      roleContext,
      destinationProject.jdAnalysis?.linkedInContext ?? undefined,
      screening.linkedInMode
    );

    return NextResponse.json({ result });
  } catch (err) {
    console.error("Transfer preview failed:", err);
    // See lib/errorMessage.ts — Supabase throws plain PostgrestError-shaped
    // objects, not real Error instances, so `err instanceof Error` alone
    // was silently swallowing the actual failure message here too.
    return NextResponse.json({ error: errorMessage(err, "Screening failed") }, { status: 500 });
  }
}
