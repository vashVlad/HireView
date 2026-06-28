import { NextRequest, NextResponse } from "next/server";
import { getAnthropicClient, CLAUDE_MODEL } from "@/lib/anthropic";
import { extractResumeText } from "@/lib/parseResume";
import { getScreeningResume } from "@/lib/screenings";
import { getSupabaseClient } from "@/lib/supabase";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const { screeningId, concern } = await request.json();

  if (!screeningId || !concern) {
    return NextResponse.json({ error: "screeningId and concern are required" }, { status: 400 });
  }

  // Fetch JD from the screening record
  const { data, error } = await getSupabaseClient()
    .from("screenings")
    .select("job_description")
    .eq("id", screeningId)
    .single<{ job_description: string }>();

  if (error || !data) {
    return NextResponse.json({ error: "Screening not found" }, { status: 404 });
  }

  // Fetch and parse the resume
  const resumeData = await getScreeningResume(screeningId);
  if (!resumeData) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }

  const resumeText = await extractResumeText(resumeData.fileName, resumeData.data);

  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `You are a recruiting assistant. A recruiter flagged this concern about a candidate:

"${concern}"

Give 2-3 sentences of specific evidence from the resume explaining why this is a concern. Be direct — cite actual roles, dates, or missing items. No filler.

JOB DESCRIPTION:
${data.job_description}

RESUME:
${resumeText}`,
      },
    ],
  });

  const text = message.content.find((b) => b.type === "text");
  return NextResponse.json({ detail: text?.type === "text" ? text.text : "" });
}
