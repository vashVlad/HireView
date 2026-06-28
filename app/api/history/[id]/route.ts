import { NextRequest, NextResponse } from "next/server";
import { deleteScreening, getScreeningsByIds, updateScreeningCredibility, updateScreeningFlag, updateScreeningNotes, updateScreeningStatus } from "@/lib/screenings";
import { CANDIDATE_STATUSES, type CandidateStatus } from "@/lib/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const screeningId = Number(id);
  if (!Number.isInteger(screeningId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const records = await getScreeningsByIds([screeningId]);
    if (!records[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ screening: records[0] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

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

  // Save credibility assessment
  if (body?.credibility && typeof body.credibility === "object") {
    try {
      await updateScreeningCredibility(screeningId, body.credibility);
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 }
      );
    }
  }

  // Update notes
  if (typeof body?.notes === "string") {
    try {
      await updateScreeningNotes(screeningId, body.notes);
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 }
      );
    }
  }

  // Toggle flag
  if (typeof body?.flagged === "boolean") {
    try {
      const flagNote = typeof body.flagNote === "string" ? body.flagNote : undefined;
      await updateScreeningFlag(screeningId, body.flagged, flagNote);
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 }
      );
    }
  }

  const status = body?.status as CandidateStatus | undefined;

  if (!status || !CANDIDATE_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status or flagged value" }, { status: 400 });
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
