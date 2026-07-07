import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { generateInterviewQuestions } from "@/lib/generateInterviewQuestions";
import { updateScreening } from "@/lib/screenings";

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
    .select("candidate_name, career_trajectory, summary, concerns, job_description, interview_questions")
    .eq("id", numId)
    .single<{
      candidate_name: string;
      career_trajectory: string | null;
      summary: string;
      concerns: string[];
      job_description: string;
      interview_questions: string[] | null;
    }>();

  if (error || !row) {
    return NextResponse.json({ error: "Screening not found" }, { status: 404 });
  }

  // Return cached questions if available
  if (row.interview_questions && row.interview_questions.length > 0) {
    return NextResponse.json({ questions: row.interview_questions, cached: true });
  }

  // Generate and cache
  try {
    const questions = await generateInterviewQuestions({
      candidateName: row.candidate_name,
      careerTrajectory: row.career_trajectory ?? row.summary,
      concerns: row.concerns ?? [],
      jobDescription: row.job_description,
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
