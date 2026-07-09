import { NextRequest, NextResponse } from "next/server";
import { upsertTrackerEntry } from "@/lib/screenings";
import { getSupabaseClient } from "@/lib/supabase";
import { getAuthUser } from "@/lib/auth";
import type { TrackerStage } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ screeningId: string }> }
) {
  const { screeningId } = await params;
  const id = parseInt(screeningId, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("tracker")
    .select("stage")
    .eq("screening_id", id)
    .maybeSingle<{ stage: TrackerStage }>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stage: data?.stage ?? null });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ screeningId: string }> }
) {
  const { screeningId } = await params;
  const id = parseInt(screeningId, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const user = await getAuthUser();

  try {
    await upsertTrackerEntry(
      id,
      {
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
        ...(body.scheduled !== undefined && { scheduled: body.scheduled }),
        ...(body.interviewDate !== undefined && { interviewDate: body.interviewDate }),
        ...(body.orderIndex !== undefined && { orderIndex: body.orderIndex }),
      },
      user?.id
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
