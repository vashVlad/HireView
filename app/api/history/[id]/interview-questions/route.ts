import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { generateInterviewQuestions, hasFraudSignal, type FraudSignals } from "@/lib/generateInterviewQuestions";
import { updateScreening } from "@/lib/screenings";
import type { CredibilityAssessment } from "@/lib/types";

export const maxDuration = 30;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const supabase = getSupabaseClient();

  // Fetch the screening record
  const { data: row, error } = await supabase
    .from("screenings")
    .select("candidate_name, career_trajectory, summary, concerns, job_description, interview_questions, duplicate_flag, history_alert_type, credibility")
    .eq("id", numId)
    .single<{
      candidate_name: string;
      career_trajectory: string | null;
      summary: string;
      concerns: string[];
      job_description: string;
      interview_questions: string[] | null;
      duplicate_flag: boolean | null;
      history_alert_type: "previously_seen" | "known_fraud_pattern" | null;
      credibility: CredibilityAssessment | null;
    }>();

  if (error || !row) {
    return NextResponse.json({ error: "Screening not found" }, { status: 404 });
  }

  // Return cached questions if available
  if (row.interview_questions && row.interview_questions.length > 0) {
    return NextResponse.json({ questions: row.interview_questions, cached: true });
  }

  // Phase 1.5 — computed for every candidate, but only passed through to the
  // prompt when something's actually flagged (hasFraudSignal below); a clean
  // candidate gets the exact same prompt as before this feature existed.
  const fraudSignals: FraudSignals = {
    duplicateFlag: row.duplicate_flag ?? false,
    ...(row.history_alert_type != null ? { historyAlertType: row.history_alert_type } : {}),
    credibilityDiscrepancies: (row.credibility?.rows ?? [])
      .filter((r) => r.status === "discrepancy")
      .map((r) => `${r.field} — resume says "${r.resume}", cross-reference says "${r.crossRef}"`),
  };

  // Generate and cache
  try {
    const questions = await generateInterviewQuestions({
      candidateName: row.candidate_name,
      careerTrajectory: row.career_trajectory ?? row.summary,
      concerns: row.concerns ?? [],
      jobDescription: row.job_description,
      ...(hasFraudSignal(fraudSignals) ? { fraudSignals } : {}),
    });

    await updateScreening(numId, { interviewQuestions: questions });

    return NextResponse.json({ questions, cached: false });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate questions" },
      { status: 500 }
    );
  }
}
