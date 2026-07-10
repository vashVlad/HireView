import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase";

/**
 * Fetches every registered HireView user via the Supabase Auth admin API.
 * Shared by admin dashboards (Analytics, FunnelView) that need to attribute
 * activity to a recruiter, so both derive from one call instead of each
 * page independently calling supabase.auth.admin.listUsers(). Silently
 * returns an empty list on error, matching how both call sites already
 * tolerated a failed lookup before this was extracted.
 */
export async function getAuthUsers(): Promise<User[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) return [];
  return data.users;
}

/** id → email lookup, falling back to the id itself if no email is set. */
export async function getRecruiterEmailMap(): Promise<Map<string, string>> {
  const users = await getAuthUsers();
  return new Map(users.map((u) => [u.id, u.email ?? u.id]));
}
