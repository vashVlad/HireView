import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { addTeamMember, removeTeamMember } from "@/lib/teams";

/** POST /api/admin/teams/[id]/members — add a user to a team (admin only) */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const teamId = parseInt(id, 10);
  if (!teamId) return NextResponse.json({ error: "Invalid team id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const userId = body?.userId;
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  try {
    await addTeamMember(teamId, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Team member add error:", err);
    return NextResponse.json({ error: "Failed to add member" }, { status: 500 });
  }
}

/** DELETE /api/admin/teams/[id]/members — remove a user from a team (admin only) */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const teamId = parseInt(id, 10);
  if (!teamId) return NextResponse.json({ error: "Invalid team id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const userId = body?.userId;
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  try {
    await removeTeamMember(teamId, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Team member remove error:", err);
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }
}
