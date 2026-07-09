import { NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { listTeamsWithMembers, getUserTeamIds } from "@/lib/teams";

/**
 * GET /api/teams — any logged-in user, unlike /api/admin/teams which is
 * admin-only. Admins get every team (same data as the Team management page);
 * recruiters get only the team(s) they belong to, with member emails, so the
 * Projects page can show "who's on this team" without needing admin access.
 */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const allTeams = await listTeamsWithMembers();
    if (isAdmin(user)) return NextResponse.json({ teams: allTeams });

    const myTeamIds = new Set(await getUserTeamIds(user.id));
    const teams = allTeams.filter((t) => myTeamIds.has(t.id));
    return NextResponse.json({ teams });
  } catch (err) {
    console.error("Teams GET error:", err);
    return NextResponse.json({ error: "Failed to fetch teams" }, { status: 500 });
  }
}
