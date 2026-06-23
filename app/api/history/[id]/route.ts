import { NextRequest, NextResponse } from "next/server";
import { deleteScreening, updateScreeningStatus } from "@/lib/screenings";
import { CANDIDATE_STATUSES, type CandidateStatus } from "@/lib/types";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const screeningId = Number(id);

  if (!Number.isInteger(screeningId)) {
    return NextResponse.json({ error: "Invalid screening id" }, { status: 400 });
  }

  try {
    await deleteScreening(screeningId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const screeningId = Number(id);

  if (!Number.isInteger(screeningId)) {
    return NextResponse.json({ error: "Invalid screening id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const status = body?.status as CandidateStatus | undefined;

  if (!status || !CANDIDATE_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    await updateScreeningStatus(screeningId, status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
