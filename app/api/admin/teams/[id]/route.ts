import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { deleteTeam, renameTeam } from "@/lib/teams";

/** PATCH /api/admin/teams/[id] — rename a team (admin only). Added 2026-07-15 for the admin Team/Projects page. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const teamId = parseInt(id, 10);
  if (!teamId) return NextResponse.json({ error: "Invalid team id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body?.name || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  try {
    await renameTeam(teamId, body.name);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Team rename error:", err);
    return NextResponse.json({ error: "Failed to rename team" }, { status: 500 });
  }
}

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
