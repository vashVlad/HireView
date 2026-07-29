import { NextResponse } from "next/server";

// Removed 2026-07-29 — superseded by the real "Transfer to project" status
// action (see components/StatusStageControl.tsx, lib/screenings.ts's
// transferScreeningToProject()). The passive "Moved to X" badge this route
// powered is no longer computed or rendered anywhere; Vlad: once a real
// Transfer action exists, that guess was redundant ("you won't have to
// show that chip since it will be shown in the status chip").
//
// This file could not actually be deleted from this sandbox's mount
// (unlink fails with "Operation not permitted", same known quirk as other
// stale-file cases this session) — left as an inert 410 instead of a
// working endpoint. Safe to delete for real from a normal filesystem.
export async function GET() {
  return NextResponse.json({ error: "Removed — superseded by the Transfer status action" }, { status: 410 });
}
