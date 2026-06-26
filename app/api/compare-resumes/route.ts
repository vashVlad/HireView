import { NextRequest, NextResponse } from "next/server";
import { saveComparison, getComparisonsByScreeningId, getComparisonById } from "@/lib/comparisons";
import { compareResumes } from "@/lib/compareResumes";
import { extractResumeText } from "@/lib/parseResume";
import { getScreeningResume, getScreeningsByIds } from "@/lib/screenings";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const screeningId = request.nextUrl.searchParams.get("screeningId");
  const comparisonId = request.nextUrl.searchParams.get("comparisonId");

  try {
    if (comparisonId) {
      const record = await getComparisonById(Number(comparisonId));
      if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ comparison: record });
    }
    if (screeningId) {
      const records = await getComparisonsByScreeningId(Number(screeningId));
      return NextResponse.json({ comparisons: records });
    }
    return NextResponse.json({ error: "Provide screeningId or comparisonId." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  // ── Mode A: one existing record + one uploaded file ──────────────────────
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const idField = formData.get("id");
    const fileField = formData.get("file");
    const roleField = formData.get("role");

    if (!idField || !fileField || !(fileField instanceof File)) {
      return NextResponse.json(
        { error: "Provide an existing record id and a resume file." },
        { status: 400 }
      );
    }

    const id = Number(idField);
    if (isNaN(id)) return NextResponse.json({ error: "id must be a number." }, { status: 400 });

    const [records, newBuffer] = await Promise.all([
      getScreeningsByIds([id]),
      fileField.arrayBuffer().then((ab) => Buffer.from(ab)),
    ]);

    const existing = records[0];
    if (!existing) return NextResponse.json({ error: "Record not found." }, { status: 404 });

    const existingFile = await getScreeningResume(id);
    if (!existingFile) {
      return NextResponse.json({ error: "Resume file not found for that record." }, { status: 404 });
    }

    const [existingText, newText] = await Promise.all([
      extractResumeText(existingFile.fileName, existingFile.data),
      extractResumeText(fileField.name, newBuffer),
    ]);

    const existingJobTitle =
      existing.jobDescription.split("\n").find((l) => l.trim().length > 10)?.trim().slice(0, 120) ??
      "Unknown role";
    const newRole =
      typeof roleField === "string" && roleField.trim() ? roleField.trim() : "New application";

    const comparison = await compareResumes(
      { text: existingText, fileName: existing.fileName, jobTitle: existingJobTitle },
      { text: newText, fileName: fileField.name, jobTitle: newRole }
    );

    const { id: comparisonId } = await saveComparison({
      screeningId: id,
      newResumeFilename: fileField.name,
      newResumeRole: newRole,
      verdict: comparison.verdict,
      summary: comparison.summary,
      changes: comparison.changes,
      redFlags: comparison.redFlags,
    });

    return NextResponse.json({
      screeningId: id,
      comparisonId,
      resumes: [
        {
          id: existing.id,
          candidateName: existing.candidateName,
          fileName: existing.fileName,
          score: existing.score,
          jobTitle: existingJobTitle,
          createdAt: existing.createdAt,
          source: "history" as const,
        },
        {
          id: null,
          candidateName: existing.candidateName,
          fileName: fileField.name,
          score: null,
          jobTitle: newRole,
          createdAt: new Date().toISOString(),
          source: "upload" as const,
        },
      ],
      comparison,
    });
  }

  // ── Mode B: two existing DB records ──────────────────────────────────────
  const body = await request.json().catch(() => null);
  const ids: unknown = body?.ids;

  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 4) {
    return NextResponse.json(
      { error: "Provide 2–4 screening IDs, or use multipart/form-data with id + file." },
      { status: 400 }
    );
  }

  const numericIds = ids.map(Number).filter((n) => !isNaN(n));
  if (numericIds.length < 2) {
    return NextResponse.json({ error: "IDs must be numbers." }, { status: 400 });
  }

  const records = await getScreeningsByIds(numericIds);
  if (records.length < 2) {
    return NextResponse.json({ error: "Could not find enough records." }, { status: 404 });
  }

  const withText = await Promise.all(
    records.map(async (record) => {
      const file = await getScreeningResume(record.id);
      if (!file) throw new Error(`Resume file not found for ${record.candidateName}`);
      const text = await extractResumeText(file.fileName, file.data);
      const jobTitle =
        record.jobDescription.split("\n").find((l) => l.trim().length > 10)?.trim().slice(0, 120) ??
        "Unknown role";
      return { record, text, jobTitle };
    })
  );

  const [a, b] = withText;
  const comparison = await compareResumes(
    { text: a.text, fileName: a.record.fileName, jobTitle: a.jobTitle },
    { text: b.text, fileName: b.record.fileName, jobTitle: b.jobTitle }
  );

  const { id: comparisonId } = await saveComparison({
    screeningId: a.record.id,
    newResumeFilename: b.record.fileName,
    newResumeRole: b.jobTitle,
    verdict: comparison.verdict,
    summary: comparison.summary,
    changes: comparison.changes,
    redFlags: comparison.redFlags,
  });

  return NextResponse.json({
    screeningId: a.record.id,
    comparisonId,
    resumes: withText.map(({ record, jobTitle }) => ({
      id: record.id,
      candidateName: record.candidateName,
      fileName: record.fileName,
      score: record.score,
      jobTitle,
      createdAt: record.createdAt,
      source: "history" as const,
    })),
    comparison,
  });
}
