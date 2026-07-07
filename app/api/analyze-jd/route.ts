import { NextRequest, NextResponse } from "next/server";
import { analyzeJobDescription } from "@/lib/analyzeJD";
import { extractResumeText } from "@/lib/parseResume";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  let jobDescription: string;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("jdFile");
    const text = formData.get("jobDescription");

    if (file instanceof File) {
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        jobDescription = await extractResumeText(file.name, buffer);
      } catch {
        return NextResponse.json({ error: "Could not read JD file" }, { status: 400 });
      }
    } else if (typeof text === "string" && text.trim()) {
      jobDescription = text;
    } else {
      return NextResponse.json({ error: "Provide a JD file or text" }, { status: 400 });
    }
  } else {
    const body = await request.json().catch(() => null);
    jobDescription = body?.jobDescription;
    if (typeof jobDescription !== "string" || !jobDescription.trim()) {
      return NextResponse.json({ error: "jobDescription is required" }, { status: 400 });
    }
  }

  try {
    const analysis = await analyzeJobDescription(jobDescription);
    return NextResponse.json({ analysis, jobDescription });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
