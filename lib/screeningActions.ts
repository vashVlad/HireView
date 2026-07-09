import { getSupabaseClient } from "./supabase";

export type ActionType =
  | "created"
  | "status_change"
  | "stage_change"
  | "flagged"
  | "unflagged"
  | "note"
  | "credibility_check";

export interface ScreeningAction {
  id: number;
  screeningId: number;
  userId: string | null;
  userEmail: string;
  actionType: ActionType;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}

interface ActionRow {
  id: number;
  screening_id: number;
  user_id: string | null;
  action_type: ActionType;
  from_value: string | null;
  to_value: string | null;
  created_at: string;
}

/** Best-effort — a logging failure must never block the underlying screening/tracker update. */
export async function logAction(params: {
  screeningId: number;
  userId?: string;
  actionType: ActionType;
  fromValue?: string | null;
  toValue?: string | null;
}): Promise<void> {
  if (!params.userId) return; // no acting user known — nothing to attribute
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("screening_actions").insert({
      screening_id: params.screeningId,
      user_id: params.userId,
      action_type: params.actionType,
      from_value: params.fromValue ?? null,
      to_value: params.toValue ?? null,
    });
    if (error) throw error;
  } catch (err) {
    console.error("Failed to log screening action:", err);
  }
}

/** Full attribution timeline for one candidate, oldest first, with recruiter emails resolved. */
export async function getActionTimeline(screeningId: number): Promise<ScreeningAction[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("screening_actions")
    .select("id, screening_id, user_id, action_type, from_value, to_value, created_at")
    .eq("screening_id", screeningId)
    .order("created_at", { ascending: true })
    .returns<ActionRow[]>();
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const userIds = Array.from(new Set(data.map((r) => r.user_id).filter((id): id is string => !!id)));
  const emailMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: usersData } = await supabase.auth.admin.listUsers();
    for (const u of usersData?.users ?? []) {
      if (userIds.includes(u.id)) emailMap.set(u.id, u.email ?? u.id);
    }
  }

  return data.map((row) => ({
    id: row.id,
    screeningId: row.screening_id,
    userId: row.user_id,
    userEmail: row.user_id ? emailMap.get(row.user_id) ?? row.user_id : "Unknown",
    actionType: row.action_type,
    fromValue: row.from_value,
    toValue: row.to_value,
    createdAt: row.created_at,
  }));
}
