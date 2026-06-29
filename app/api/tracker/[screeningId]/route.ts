import { NextRequest, NextResponse } from "next/server";
import { upsertTrackerEntry } from "@/lib/screenings";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ screeningId: string }> }
) {
  const { screeningId } = await params;
  const id = parseInt(screeningId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid screeningId" }, { status: 400 });
  }

  const body = await request.json();

  try {
    await upsertTrackerEntry(id, {
      ...(body.stage !== undefined && { stage: body.stage }),
      ...(body.leverId !== undefined && { leverId: body.leverId }),
      ...(body.company !== undefined && { company: body.company }),
      ...(body.role !== undefined && { role: body.role }),
      ...(body.expectedLevel !== undefined && { expectedLevel: body.expectedLevel }),
      ...(body.nextStep !== undefined && { nextStep: body.nextStep }),
      ...(body.stepsCompleted !== undefined && { stepsCompleted: body.stepsCompleted }),
      ...(body.comments !== undefined && { comments: body.comments }),
      ...(body.immigration !== undefined && { immigration: body.immigration }),
      ...(body.onHold !== undefined && { onHold: body.onHold }),
      ...(body.onHoldReason !== undefined && { onHoldReason: body.onHoldReason }),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Tracker PATCH error:", err);
    return NextResponse.json({ error: "Failed to update tracker entry" }, { status: 500 });
  }
}
