import { NextResponse } from "next/server";
import { deleteCalibrationExample } from "@/lib/calibrationExamples";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const exampleId = Number(id);

  if (!Number.isInteger(exampleId)) {
    return NextResponse.json({ error: "Invalid example id" }, { status: 400 });
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
