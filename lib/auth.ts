import type { User } from "@supabase/supabase-js";
import { getSessionSupabaseClient } from "./supabase-server";
import { getUserTeamIds } from "./teams";

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
