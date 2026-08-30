import { NextRequest, NextResponse } from "next/server";
import { assessFraudRisk } from "@/lib/assessFraudRisk";
import { listFraudCalibrationExamples } from "@/lib/fraudCalibrationExamples";
import { extractResumeText } from "@/lib/parseResume";
import { getScreeningResume } from "@/lib/screenings";
import { canAccessScreening, getAuthUser } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import type { CredibilityAssessment } from "@/lib/types";

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

  // Reuse audit, 2026-08-28 — this check used to run completely blind to
  // what the initial screening and any prior credibility check already
  // found (see buildKnownConcernsBlock/buildCredibilityContextBlock's doc
  // comments in lib/assessFraudRisk.ts). Best-effort: a failed fetch here
  // degrades to the old blind behavior rather than failing the whole check.
  let concerns: string[] | undefined;
  let strengths: string[] | undefined;
  let credibility: CredibilityAssessment | undefined;
  try {
    const { data: row } = await getSupabaseClient()
      .from("screenings")
      .select("concerns, strengths, credibility")
      .eq("id", screeningId)
      .single<{ concerns: string[] | null; strengths: string[] | null; credibility: CredibilityAssessment | null }>();
    concerns = row?.concerns ?? undefined;
    strengths = row?.strengths ?? undefined;
    credibility = row?.credibility ?? undefined;
  } catch {
    // Degrade gracefully — see comment above.
  }

  let assessment;
  try {
    assessment = await assessFraudRisk({ resumeText, roleContext, calibrationExamples, concerns, strengths, credibility });
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
