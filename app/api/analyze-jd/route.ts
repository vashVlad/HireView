import { NextRequest, NextResponse } from "next/server";
import { analyzeJobDescription } from "@/lib/analyzeJD";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const jobDescription = body?.jobDescription;

  if (typeof jobDescription !== "string" || !jobDescription.trim()) {
    return NextResponse.json({ error: "jobDescription is required" }, { status: 400 });
  }

  try {
    const analysis = await analyzeJobDescription(jobDescription);
    return NextResponse.json({ analysis });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
