import type { User } from "@supabase/supabase-js";
import { getSessionSupabaseClient } from "./supabase-server";
import { getUserTeamIds } from "./teams";
import { getSupabaseClient } from "./supabase";

export type AuthUser = User & {
  app_metadata: { role?: "admin" | "recruiter" };
};

/**
 * Returns the authenticated user from the current session, or null if not logged in.
 * Call this at the top of every API route that needs auth.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const supabase = await getSessionSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user as AuthUser | null;
}

export function isAdmin(user: AuthUser): boolean {
  return user.app_metadata?.role === "admin";
}

/** Returns user.id when recruiter, undefined when admin (no filter). */
export function userIdFilter(user: AuthUser): string | undefined {
  return isAdmin(user) ? undefined : user.id;
}

/**
 * Returns the team IDs a recruiter should be scoped to, undefined when admin
 * (no filter — sees everything regardless of team). A recruiter with no team
 * membership gets an empty array, which callers should treat as "sees nothing."
 */
export async function teamIdsFilter(user: AuthUser): Promise<number[] | undefined> {
  if (isAdmin(user)) return undefined;
  return getUserTeamIds(user.id);
}

// ── Per-resource access checks ──────────────────────────────────────────────
//
// Found during the 2026-07-16 full-codebase audit: every LIST endpoint
// (GET /api/projects, GET /api/history, etc.) correctly scopes by team via
// teamIdsFilter() above, but the single-resource BY-ID routes (resume
// download, photo, LinkedIn PDF, credibility check, tracker data, calibration
// delete, and more) never checked that the requesting user's team actually
// owns the record — any authenticated user, on any team, could read or edit
// another team's screening/project just by knowing its numeric id (ids are
// sequential, easy to enumerate). These three helpers are the one shared
// place that check, so every by-id route can call one line instead of each
// re-deriving its own team-membership logic (and inevitably drifting).
//
// A record with no team_id (unassigned — same "orphaned" state deleteTeam()
// leaves behind) is admin-only, matching how team-scoped list queries already
// treat NULL: `.in("team_id", teamIds)` can never match it, so only an admin
// (who bypasses team scoping entirely) can see it today.

export async function canAccessScreening(user: AuthUser, screeningId: number): Promise<boolean> {
  if (isAdmin(user)) return true;
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from("screenings")
    .select("team_id")
    .eq("id", screeningId)
    .maybeSingle<{ team_id: number | null }>();
  if (!data || data.team_id == null) return false;
  const teamIds = await getUserTeamIds(user.id);
  return teamIds.includes(data.team_id);
}

export async function canAccessProject(user: AuthUser, projectId: number): Promise<boolean> {
  if (isAdmin(user)) return true;
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from("projects")
    .select("team_id")
    .eq("id", projectId)
    .maybeSingle<{ team_id: number | null }>();
  if (!data || data.team_id == null) return false;
  const teamIds = await getUserTeamIds(user.id);
  return teamIds.includes(data.team_id);
}

/**
 * Calibration examples aren't team-scoped like screenings/projects — they're
 * scoped per-recruiter (see lib/calibrationExamples.ts's listCalibrationExamples,
 * filtered by user_id). So ownership here means "you created it," not "your
 * team owns it."
 */
export async function canAccessCalibrationExample(user: AuthUser, exampleId: number): Promise<boolean> {
  if (isAdmin(user)) return true;
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from("calibration_examples")
    .select("user_id")
    .eq("id", exampleId)
    .maybeSingle<{ user_id: string | null }>();
  if (!data || data.user_id == null) return false;
  return data.user_id === user.id;
}
