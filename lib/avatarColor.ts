// Shared colored-initial avatar helpers — used by the Activity timeline
// (Phase 1.2) and the team member chips on the Projects page. Deterministic
// per email so the same person always gets the same color across views.

export const AVATAR_COLORS = ["bg-violet-500", "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-cyan-500", "bg-indigo-500"];

export function avatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function avatarInitial(email: string): string {
  return email.trim().charAt(0).toUpperCase() || "?";
}
