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
  const text = await extractResumeText(file.name, buffer);

  if (!text.trim()) {
    return NextResponse.json({ error: "Could not extract text from file" }, { status: 422 });
  }

  return NextResponse.json({ text: text.trim() });
}
