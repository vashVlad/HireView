import { NextRequest, NextResponse } from "next/server";
import { getAnthropicClient, CLAUDE_MODEL } from "@/lib/anthropic";
import { extractResumeText } from "@/lib/parseResume";
import { getScreeningResume } from "@/lib/screenings";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const { screeningId, experience } = await request.json();

  if (!screeningId || !experience) {
    return NextResponse.json(
      { error: "screeningId and experience are required" },
      { status: 400 }
    );
  }

  const resumeData = await getScreeningResume(screeningId);
  if (!resumeData) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }

  const resumeText = await extractResumeText(resumeData.fileName, resumeData.data);

  const message = await getAnthropicClient().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `You are helping a recruiter prepare for a quick candidate screen. Generate ONE conversational question to verify this candidate's experience with: "${experience}".

Rules:
- Not technical — this is a soft check, not an interview
- Should prompt the candidate to describe what they actually did, not prove knowledge
- Conversational tone, like something you'd ask on a 15-minute call
- Reference a specific detail from their resume about this experience so it feels personal, not generic
- One sentence. No preamble.

RESUME:
${resumeText}`,
      },
    ],
  });

  const text = message.content.find((b) => b.type === "text");
  return NextResponse.json({
    question: text?.type === "text" ? text.text.trim() : "",
  });
}
