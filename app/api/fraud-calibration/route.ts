import { NextRequest, NextResponse } from "next/server";
import { saveFraudCalibrationExample, listFraudCalibrationExamples, deleteFraudCalibrationExample } from "@/lib/fraudCalibrationExamples";
import { extractResumeText } from "@/lib/parseResume";
import { getScreeningResume } from "@/lib/screenings";
import { canAccessScreening, getAuthUser } from "@/lib/auth";
import { FRAUD_PATTERN_TYPES, type FraudCalibrationClaim, type FraudPatternType } from "@/lib/types";

/**
 * Saves a confirmed-fraud calibration example FROM an already-screened,
 * already-rejected candidate — this is RejectionCard.tsx's "Suspected
 * fraud" checkbox path (Vlad's ask, 2026-07-29). Deliberately takes a
 * screeningId, not a file upload: the resume already exists in storage from
 * the original screening (getScreeningResume), so there's nothing new to
 * upload — only the fraud classification (patternType + specific claims) is
 * new information here.
 *
 * Best-effort by design (mirrors lib/fraudCalibrationExamples.ts's own
 * fail-closed behavior): a save failure here must never block the rejection
 * itself, which is why this always returns 200 with { saved: boolean }
 * rather than a hard error status — see that file's saveFraudCalibrationExample
 * doc comment for the full reasoning.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.screeningId !== "number") {
    return NextResponse.json({ error: "screeningId is required" }, { status: 400 });
  }

  const { screeningId } = body;
  const patternType: FraudPatternType = FRAUD_PATTERN_TYPES.includes(body.patternType) ? body.patternType : "other";
  const claims: FraudCalibrationClaim[] = Array.isArray(body.claims)
    ? body.claims
        .filter((c: unknown): c is { claimText?: unknown; explanation?: unknown } => typeof c === "object" && c !== null)
        .map((c: { claimText?: unknown; explanation?: unknown }) => ({
          claimText: typeof c.claimText === "string" ? c.claimText : "",
          explanation: typeof c.explanation === "string" ? c.explanation : "",
        }))
        .filter((c: FraudCalibrationClaim) => c.claimText.trim().length > 0)
    : [];

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessScreening(user, screeningId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let resumeData;
  try {
    resumeData = await getScreeningResume(screeningId);
  } catch {
    return NextResponse.json({ saved: false }, { status: 200 });
  }

  let extractedText: string;
  try {
    extractedText = await extractResumeText(resumeData.fileName, resumeData.data);
  } catch {
    return NextResponse.json({ saved: false }, { status: 200 });
  }

  const example = await saveFraudCalibrationExample({
    patternType,
    claims,
    fileName: resumeData.fileName,
    extractedText,
    resumeFile: resumeData.data,
    resumeMimeType: resumeData.mimeType,
    sourceScreeningId: screeningId,
    userId: user.id,
  });

  return NextResponse.json({ saved: example !== null, example });
}

/** Used by any future calibration-library management UI — not wired up yet, mirrors GET on the existing /api/calibration-examples route (see that route for the sibling project-scoped calibration library). */
export async function GET(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patternTypeParam = request.nextUrl.searchParams.get("patternType");
  const patternType = FRAUD_PATTERN_TYPES.includes(patternTypeParam as FraudPatternType)
    ? (patternTypeParam as FraudPatternType)
    : undefined;

  const examples = await listFraudCalibrationExamples(patternType);
  return NextResponse.json({ examples });
}

export async function DELETE(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const idParam = request.nextUrl.searchParams.get("id");
  const id = idParam ? parseInt(idParam, 10) : NaN;
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  await deleteFraudCalibrationExample(id);
  return NextResponse.json({ ok: true });
}
