import { NextResponse } from "next/server";
import { deleteCalibrationExample } from "@/lib/calibrationExamples";
import { canAccessCalibrationExample, getAuthUser } from "@/lib/auth";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const exampleId = Number(id);

  if (!Number.isInteger(exampleId)) {
    return NextResponse.json({ error: "Invalid example id" }, { status: 400 });
  }

  // Added in the 2026-07-16 audit — this route had zero auth check at all,
  // letting any logged-in user delete any other recruiter's calibration
  // examples. Ownership here is per-recruiter, not per-team (see
  // lib/calibrationExamples.ts).
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessCalibrationExample(user, exampleId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await deleteCalibrationExample(exampleId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
