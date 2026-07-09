import { NextRequest, NextResponse } from "next/server";
import { deleteScreening, getScreeningsByIds, updateScreening, updateScreeningCredibility, updateScreeningFlag, updateScreeningNotes, updateScreeningStatus } from "@/lib/screenings";
import { getAuthUser } from "@/lib/auth";
import { CANDIDATE_STATUSES, type CandidateStatus } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    const records = await getScreeningsByIds([numId]);
    if (!records.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ screening: records[0] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const user = await getAuthUser();
  const actorUserId = user?.id;

  try {
    if (body.status !== undefined) {
      if (!CANDIDATE_STATUSES.includes(body.status as CandidateStatus)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      await updateScreeningStatus(numId, body.status as CandidateStatus, actorUserId);
    }
    if (body.flagged !== undefined) {
      await updateScreeningFlag(numId, body.flagged, body.flagNote, actorUserId);
    }
    if (body.notes !== undefined) {
      await updateScreeningNotes(numId, body.notes, actorUserId);
    }
    if (body.leverUrl !== undefined) {
      await updateScreening(numId, { leverUrl: body.leverUrl });
    }
    if (body.credibility !== undefined) {
      await updateScreeningCredibility(numId, body.credibility, actorUserId);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    await deleteScreening(numId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
