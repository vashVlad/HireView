import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { deleteTeam } from "@/lib/teams";

/** DELETE /api/admin/teams/[id] — delete a team (admin only) */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const teamId = parseInt(id, 10);
  if (!teamId) return NextResponse.json({ error: "Invalid team id" }, { status: 400 });

  try {
    await deleteTeam(teamId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Team delete error:", err);
    return NextResponse.json({ error: "Failed to delete team" }, { status: 500 });
  }
}
