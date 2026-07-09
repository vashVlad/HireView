import { getSupabaseClient } from "./supabase";

export interface Team {
  id: number;
  name: string;
  createdAt: string;
}

export interface TeamWithMembers extends Team {
  members: { userId: string; email: string | null }[];
}

/** Team IDs a user belongs to. Empty array means "no team" (sees nothing team-scoped). */
export async function getUserTeamIds(userId: string): Promise<number[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId)
    .returns<{ team_id: number }[]>();
  if (error) throw error;
  return (data ?? []).map((r) => r.team_id);
}

/** First team a user belongs to — used to auto-assign new projects/screenings. */
export async function getPrimaryTeamId(userId: string): Promise<number | null> {
  const ids = await getUserTeamIds(userId);
  return ids[0] ?? null;
}

export async function createTeam(name: string, createdBy?: string): Promise<Team> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("teams")
    .insert({ name: name.trim(), created_by: createdBy ?? null })
    .select("id, name, created_at")
    .single<{ id: number; name: string; created_at: string }>();
  if (error) throw error;
  return { id: data.id, name: data.name, createdAt: data.created_at };
}

export async function listTeamsWithMembers(): Promise<TeamWithMembers[]> {
  const supabase = getSupabaseClient();

  const { data: teams, error: teamsErr } = await supabase
    .from("teams")
    .select("id, name, created_at")
    .order("created_at", { ascending: true })
    .returns<{ id: number; name: string; created_at: string }[]>();
  if (teamsErr) throw teamsErr;
  if (!teams || teams.length === 0) return [];

  const { data: members, error: membersErr } = await supabase
    .from("team_members")
    .select("team_id, user_id")
    .in("team_id", teams.map((t) => t.id))
    .returns<{ team_id: number; user_id: string }[]>();
  if (membersErr) throw membersErr;

  // Resolve emails via admin auth API (team_members only stores user_id).
  const { data: usersRes } = await supabase.auth.admin.listUsers();
  const emailByUserId = new Map((usersRes?.users ?? []).map((u) => [u.id, u.email ?? null]));

  const membersByTeam = new Map<number, { userId: string; email: string | null }[]>();
  for (const m of members ?? []) {
    const list = membersByTeam.get(m.team_id) ?? [];
    list.push({ userId: m.user_id, email: emailByUserId.get(m.user_id) ?? null });
    membersByTeam.set(m.team_id, list);
  }

  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    createdAt: t.created_at,
    members: membersByTeam.get(t.id) ?? [],
  }));
}

export async function addTeamMember(teamId: number, userId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("team_members")
    .insert({ team_id: teamId, user_id: userId })
    .select()
    .maybeSingle();
  // Ignore unique-constraint violation (already a member) — idempotent add.
  if (error && error.code !== "23505") throw error;
}

export async function removeTeamMember(teamId: number, userId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);
  if (error) throw error;
}
