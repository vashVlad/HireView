import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { createTeam, listTeamsWithMembers } from "@/lib/teams";

/** GET /api/admin/teams — list all teams with their members (admin only) */
export async function GET() {
  const user = await getAuthUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const teams = await listTeamsWithMembers();
    return NextResponse.json({ teams });
  } catch (err) {
    console.error("Teams GET error:", err);
    return NextResponse.json({ error: "Failed to fetch teams" }, { status: 500 });
  }
}

/** POST /api/admin/teams — create a new team (admin only) */
export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const name = body?.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const team = await createTeam(name, user.id);
    return NextResponse.json({ team });
  } catch (err) {
    console.error("Teams POST error:", err);
    return NextResponse.json({ error: "Failed to create team" }, { status: 500 });
  }
}
