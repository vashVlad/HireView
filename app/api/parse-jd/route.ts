import { NextRequest, NextResponse } from "next/server";
import { extractResumeText } from "@/lib/parseResume";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Real error handling, 2026-08-25 — matches the same try/catch every
  // other extractResumeText() caller already has (analyze-jd,
  // extract-jd-text, calibrate); this one was the odd one out, so a
  // malformed/corrupt file previously fell through to Next.js's bodyless
  // default 500 instead of a clean, diagnosable message.
  try {
    const text = await extractResumeText(file.name, buffer);
    if (!text.trim()) {
      return NextResponse.json({ error: "Could not extract text from file" }, { status: 422 });
    }
    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    console.error("parse-jd text extraction failed:", err);
    return NextResponse.json({ error: "Could not extract text from file" }, { status: 422 });
  }
}
