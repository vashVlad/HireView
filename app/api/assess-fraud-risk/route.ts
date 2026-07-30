import { NextRequest, NextResponse } from "next/server";
import { assessFraudRisk } from "@/lib/assessFraudRisk";
import { listFraudCalibrationExamples } from "@/lib/fraudCalibrationExamples";
import { extractResumeText } from "@/lib/parseResume";
import { getScreeningResume } from "@/lib/screenings";
import { canAccessScreening, getAuthUser } from "@/lib/auth";

// Manual-trigger only, capped at 60s — Vlad's ask, 2026-07-29: fraud risk
// checking must never run inside the batch-screening path (a slow/failed
// check there could push the whole batch over its own route's timeout).
// Kept as its own dedicated, opt-in route so a timeout or failure here only
// ever errors this one check, never a batch of candidates.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.screeningId !== "number") {
    return NextResponse.json({ error: "screeningId is required" }, { status: 400 });
  }

  const { screeningId } = body;
  const roleContext = typeof body.roleContext === "string" ? body.roleContext : undefined;

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessScreening(user, screeningId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let resumeText: string;
  try {
    const resumeData = await getScreeningResume(screeningId);
    resumeText = await extractResumeText(resumeData.fileName, resumeData.data);
  } catch {
    return NextResponse.json({ error: "Could not load or read this candidate's resume" }, { status: 500 });
  }

  const calibrationExamples = await listFraudCalibrationExamples();

  let assessment;
  try {
    assessment = await assessFraudRisk({ resumeText, roleContext, calibrationExamples });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fraud risk check failed" },
      { status: 500 }
    );
  }

  // Deliberately does NOT persist here — mirrors assess-credibility's
  // architecture exactly: this route only computes and returns the result,
  // FraudRiskChecker.tsx's onComplete is what PATCHes /api/history/[id] with
  // it. Persisting silently in both places would risk exactly the bug Vlad
  // reported for credibility on 2026-07-15 (a swallowed .catch(() => {})
  // here would make a real save failure invisible to the UI) — see that
  // route and PATCH handler's comments for the full reasoning.
  return NextResponse.json({ assessment });
}
