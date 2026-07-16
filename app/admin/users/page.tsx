"use client";

import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { PageHeader } from "@/components/PageHeader";
import { avatarColor, avatarInitial } from "@/lib/avatarColor";

/**
 * Redesign pass, 2026-07-15 (Vlad's ask: "make it look more special and
 * interactive" — this page was the flattest, most generic-CRUD-looking
 * screen in the app). TEAM_PALETTE gives each team a stable accent color
 * (dot/border/soft-bg/text quad, all literal Tailwind class strings so the
 * v4 JIT scanner picks them up — same reasoning as StatusSelect.tsx's
 * STATUS_COLORS map) derived from a deterministic hash of the team name,
 * independent from lib/avatarColor.ts's per-user palette so a team's accent
 * and its members' individual avatar colors don't visually collide.
 */
const TEAM_PALETTE = [
  { dot: "bg-violet-500", border: "border-violet-200 dark:border-violet-500/30", soft: "bg-violet-50 dark:bg-violet-500/10", text: "text-violet-700 dark:text-violet-400", ring: "ring-violet-400/40" },
  { dot: "bg-sky-500", border: "border-sky-200 dark:border-sky-500/30", soft: "bg-sky-50 dark:bg-sky-500/10", text: "text-sky-700 dark:text-sky-400", ring: "ring-sky-400/40" },
  { dot: "bg-emerald-500", border: "border-emerald-200 dark:border-emerald-500/30", soft: "bg-emerald-50 dark:bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-400", ring: "ring-emerald-400/40" },
  { dot: "bg-amber-500", border: "border-amber-200 dark:border-amber-500/30", soft: "bg-amber-50 dark:bg-amber-500/10", text: "text-amber-700 dark:text-amber-400", ring: "ring-amber-400/40" },
  { dot: "bg-rose-500", border: "border-rose-200 dark:border-rose-500/30", soft: "bg-rose-50 dark:bg-rose-500/10", text: "text-rose-700 dark:text-rose-400", ring: "ring-rose-400/40" },
  { dot: "bg-cyan-500", border: "border-cyan-200 dark:border-cyan-500/30", soft: "bg-cyan-50 dark:bg-cyan-500/10", text: "text-cyan-700 dark:text-cyan-400", ring: "ring-cyan-400/40" },
  { dot: "bg-indigo-500", border: "border-indigo-200 dark:border-indigo-500/30", soft: "bg-indigo-50 dark:bg-indigo-500/10", text: "text-indigo-700 dark:text-indigo-400", ring: "ring-indigo-400/40" },
];

function teamPalette(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return TEAM_PALETTE[hash % TEAM_PALETTE.length];
}

interface UserRow {
  id: string;
  email: string;
  role: "admin" | "recruiter";
  createdAt: string;
  lastSignIn: string | null;
  confirmed: boolean;
}

interface AccessRequest {
  id: number;
  created_at: string;
  name: string | null;
  email: string;
  message: string | null;
  status: string;
}

interface TeamRow {
  id: number;
  name: string;
  createdAt: string;
  members: { userId: string; email: string | null }[];
}

/**
 * Minimal shape pulled from GET /api/projects (ProjectSummary) — only what
 * the drag-and-drop Team/Projects UI needs. Added 2026-07-15, Vlad's ask:
 * "assign projects to team and then members to the team... make it smart."
 * Previously a project's team was set once at creation (auto-assigned to
 * the creator's primary team) with no way to see or change it afterward.
 */
interface ProjectRow {
  id: number;
  name: string;
  status: "active" | "archived" | "closed";
  teamId?: number | null;
  teamName?: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"recruiter" | "admin">("recruiter");
  const [inviteTempPassword, setInviteTempPassword] = useState("HireView2026!");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  // Access requests
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [approveResult, setApproveResult] = useState<Record<number, string>>({});

  // Teams
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [newTeamName, setNewTeamName] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
  const [editingTeamName, setEditingTeamName] = useState("");
  const [renamingTeam, setRenamingTeam] = useState(false);
  // Small popover pickers, replacing the old inline <select> + Add button
  // pattern for both members and projects (2026-07-15, Vlad's ask: "a nice,
  // small button" instead). At most one team's picker of each kind is open
  // at a time — a single id (not a per-team boolean map) makes that
  // exclusivity automatic.
  const [openMemberPickerTeamId, setOpenMemberPickerTeamId] = useState<number | null>(null);
  const [openProjectPickerTeamId, setOpenProjectPickerTeamId] = useState<number | null>(null);

  // Projects — for the drag-and-drop team assignment panel below.
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [dragProjectId, setDragProjectId] = useState<number | null>(null);
  const [dragOverTeamId, setDragOverTeamId] = useState<number | null>(null);
  const [teamProjectError, setTeamProjectError] = useState<string | null>(null);
  const [projectSearch, setProjectSearch] = useState("");

  async function fetchUsers() {
    setLoading(true);
    const res = await fetch("/api/admin/users");
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed to load users");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setUsers(data.users ?? []);
    setLoading(false);
  }

  async function fetchRequests() {
    setRequestsLoading(true);
    const res = await fetch("/api/access-requests");
    if (res.ok) {
      const data = await res.json();
      setRequests(data.requests ?? []);
    }
    setRequestsLoading(false);
  }

  async function fetchTeams() {
    setTeamsLoading(true);
    const res = await fetch("/api/admin/teams");
    if (res.ok) {
      const data = await res.json();
      setTeams(data.teams ?? []);
    }
    setTeamsLoading(false);
  }

  async function fetchProjects() {
    setProjectsLoading(true);
    const res = await fetch("/api/projects");
    if (res.ok) {
      const data = await res.json();
      setProjects(data.projects ?? []);
    }
    setProjectsLoading(false);
  }

  useEffect(() => {
    fetchUsers();
    fetchRequests();
    fetchTeams();
    fetchProjects();
  }, []);

  // Click-outside-to-close for both popover pickers. Deliberately NOT a
  // fixed/absolute full-screen overlay div (the first version used one) —
  // any ancestor with a CSS transform, including a *finished* animation
  // with fill-mode "both" (animate-fade-in-up on the team <li> rows keeps
  // `transform: translateY(0)` applied indefinitely), creates a new
  // containing block for fixed-position descendants. That silently shrank
  // the "full-screen" overlay down to the team row's own bounds, so clicks
  // meant to land on the popover's own option rows (also positioned inside
  // that same row) were unpredictably intercepted instead. A real
  // document-level listener has no containing-block ambiguity.
  useEffect(() => {
    function handleDocMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-team-picker]")) {
        setOpenMemberPickerTeamId(null);
        setOpenProjectPickerTeamId(null);
      }
    }
    document.addEventListener("mousedown", handleDocMouseDown);
    return () => document.removeEventListener("mousedown", handleDocMouseDown);
  }, []);

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    setTeamError(null);
    setCreatingTeam(true);
    const res = await fetch("/api/admin/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTeamName }),
    });
    const data = await res.json();
    if (!res.ok) {
      setTeamError(data.error ?? "Failed to create team");
    } else {
      setNewTeamName("");
      fetchTeams();
    }
    setCreatingTeam(false);
  }

  async function handleAddMember(teamId: number, userId: string) {
    const addedUser = users.find((u) => u.id === userId);

    // Optimistic update — the chip appears instantly instead of waiting on a
    // round trip. fetchTeams() below still runs to reconcile with server
    // truth. Popover picker (replaced the old <select>, 2026-07-15) closes
    // itself right after the click that triggered this.
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId && !t.members.some((m) => m.userId === userId)
          ? { ...t, members: [...t.members, { userId, email: addedUser?.email ?? null }] }
          : t
      )
    );
    setOpenMemberPickerTeamId(null);

    await fetch(`/api/admin/teams/${teamId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    fetchTeams();
  }

  async function handleRemoveMember(teamId: number, userId: string) {
    // Optimistic update, same reasoning as handleAddMember.
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId ? { ...t, members: t.members.filter((m) => m.userId !== userId) } : t
      )
    );

    await fetch(`/api/admin/teams/${teamId}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    fetchTeams();
  }

  async function handleDeleteTeam(team: TeamRow) {
    const memberNote =
      team.members.length > 0
        ? ` ${team.members.length} member${team.members.length === 1 ? "" : "s"} will lose access to this team's projects and candidates.`
        : "";
    if (
      !confirm(
        `Delete "${team.name}"? This cannot be undone.${memberNote} Any projects/candidates assigned to this team become unassigned — visible to admins only, hidden from recruiters until reassigned to a team.`
      )
    ) {
      return;
    }

    // Optimistic update, same pattern as add/remove member below.
    setTeams((prev) => prev.filter((t) => t.id !== team.id));

    await fetch(`/api/admin/teams/${team.id}`, { method: "DELETE" });
    fetchTeams();
  }

  function startEditingTeamName(team: TeamRow) {
    setEditingTeamId(team.id);
    setEditingTeamName(team.name);
  }

  async function commitTeamRename() {
    if (editingTeamId == null) return;
    const teamId = editingTeamId;
    const name = editingTeamName.trim();
    setEditingTeamId(null);
    if (!name) return; // empty edit — treat as cancel, no-op

    const prevTeams = teams;
    setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, name } : t)));
    setRenamingTeam(true);
    const res = await fetch(`/api/admin/teams/${teamId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) setTeams(prevTeams); // revert on failure
    setRenamingTeam(false);
  }

  /**
   * Moves a project onto a team (or off any team, teamId: null) via drag-
   * and-drop from the Projects rail. Admin-only at the API level (see
   * PATCH /api/projects/[id]/route.ts) — this page is already admin-gated
   * end to end, so no extra check needed here.
   */
  async function handleAssignProject(projectId: number, teamId: number | null) {
    setTeamProjectError(null);
    setOpenProjectPickerTeamId(null); // no-op if this assign came from drag-and-drop, not the picker
    const prevProjects = projects;
    const teamName = teamId != null ? teams.find((t) => t.id === teamId)?.name : undefined;
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, teamId: teamId, teamName } : p))
    );

    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId }),
    });
    if (!res.ok) {
      setProjects(prevProjects);
      const data = await res.json().catch(() => ({}));
      setTeamProjectError(data.error ?? "Failed to move project");
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteSuccess(null);
    setInviting(true);

    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole, tempPassword: inviteTempPassword || undefined }),
    });
    const data = await res.json();

    if (!res.ok) {
      setInviteError(data.error ?? "Failed to invite user");
    } else {
      setInviteSuccess(`Account created for ${inviteEmail} — they can sign in with the temporary password right away.`);
      setInviteEmail("");
      setInviteTempPassword("HireView2026!");
      fetchUsers();
    }
    setInviting(false);
  }

  async function handleApprove(req: AccessRequest) {
    setApprovingId(req.id);

    // Create user account
    const userRes = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: req.email, role: "recruiter", tempPassword: "HireView2026!" }),
    });

    if (!userRes.ok) {
      const data = await userRes.json();
      setApproveResult((prev) => ({ ...prev, [req.id]: `Error: ${data.error}` }));
      setApprovingId(null);
      return;
    }

    // Mark approved
    await fetch(`/api/access-requests/${req.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });

    setApproveResult((prev) => ({
      ...prev,
      [req.id]: `Approved — account created with password HireView2026!`,
    }));
    setApprovingId(null);
    fetchRequests();
    fetchUsers();
  }

  async function handleDismiss(req: AccessRequest) {
    await fetch(`/api/access-requests/${req.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "dismissed" }),
    });
    fetchRequests();
  }

  async function handleRoleChange(userId: string, role: "admin" | "recruiter") {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    fetchUsers();
  }

  async function handleDelete(userId: string, email: string) {
    if (!confirm(`Remove ${email}? This cannot be undone.`)) return;
    await fetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    fetchUsers();
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <SiteHeader active="/admin/users" />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <PageHeader
          icon={<>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="9" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
          </>}
          title="User Management"
          subtitle="Invite recruiters, organize teams, and reassign projects — drag and drop below."
        />

        {/* Stat strip — quick-glance counts, none of this existed before; every
            number is derived from state already being fetched, no new API calls. */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: "Team members",
              value: users.length,
              icon: (
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" strokeLinecap="round" strokeLinejoin="round" />
              ),
              accent: "from-violet-500/10 to-transparent text-violet-600 dark:text-violet-400",
            },
            {
              label: "Admins",
              value: users.filter((u) => u.role === "admin").length,
              icon: <path d="M12 2 4 6v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6l-8-4Z" strokeLinecap="round" strokeLinejoin="round" />,
              accent: "from-amber-500/10 to-transparent text-amber-600 dark:text-amber-400",
            },
            {
              label: "Teams",
              value: teams.length,
              icon: <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" strokeLinecap="round" strokeLinejoin="round" />,
              accent: "from-sky-500/10 to-transparent text-sky-600 dark:text-sky-400",
            },
            {
              label: "Pending requests",
              value: requests.length,
              icon: <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" strokeLinecap="round" strokeLinejoin="round" />,
              accent: "from-rose-500/10 to-transparent text-rose-600 dark:text-rose-400",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className={`group relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900`}
            >
              <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${stat.accent}`} />
              <div className="relative flex items-center gap-2.5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={stat.accent.split(" ").slice(-2).join(" ")}>
                  {stat.icon}
                </svg>
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{stat.label}</span>
              </div>
              <p className="relative mt-2 text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Pending access requests */}
        {(requestsLoading || requests.length > 0) && (
          <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/5">
            <div className="flex items-center gap-2 border-b border-amber-200/60 px-6 py-4 dark:border-amber-500/10">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
              </span>
              <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Pending access requests
                {requests.length > 0 && (
                  <span className="ml-2 rounded-full bg-amber-200 px-2 py-0.5 text-xs dark:bg-amber-500/20">
                    {requests.length}
                  </span>
                )}
              </h2>
            </div>

            {requestsLoading ? (
              <div className="px-6 py-4 text-sm text-amber-700 dark:text-amber-400">Loading…</div>
            ) : (
              <ul className="divide-y divide-amber-200/60 dark:divide-amber-500/10">
                {requests.map((req) => (
                  <li key={req.id} className="px-6 py-4">
                    {approveResult[req.id] ? (
                      <p className="text-sm text-emerald-600 dark:text-emerald-400">{approveResult[req.id]}</p>
                    ) : (
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                            {req.name ? `${req.name} — ` : ""}
                            <span className="font-normal">{req.email}</span>
                          </p>
                          {req.message && (
                            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                              {req.message}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">
                            {new Date(req.created_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleApprove(req)}
                            disabled={approvingId === req.id}
                            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                          >
                            {approvingId === req.id ? "Approving…" : "Approve"}
                          </button>
                          <button
                            onClick={() => handleDismiss(req)}
                            className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Invite form */}
        <div className="mb-8 rounded-2xl border border-zinc-200 bg-white p-6 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-violet-500">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M11 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM20 8v6M23 11h-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Invite a team member
          </h2>
          <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-3" style={{ minWidth: "220px", flex: 1 }}>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Email</label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@brillio.com"
                  className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Temporary password</label>
                <input
                  type="text"
                  value={inviteTempPassword}
                  onChange={(e) => setInviteTempPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
            </div>
            <div className="flex flex-col justify-between gap-3" style={{ alignSelf: "stretch" }}>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "recruiter" | "admin")}
                  className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="recruiter">Recruiter</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={inviting}
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:-translate-y-px hover:bg-violet-700 hover:shadow-md hover:shadow-violet-500/30 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
              >
                {inviting ? "Sending…" : "Send invite"}
              </button>
            </div>
          </form>
          {inviteError && (
            <p className="mt-2 text-sm text-rose-500">{inviteError}</p>
          )}
          {inviteSuccess && (
            <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">{inviteSuccess}</p>
          )}
        </div>

        {/* User table */}
        <div className="rounded-2xl border border-zinc-200 bg-white transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Team members{users.length > 0 && ` (${users.length})`}
            </h2>
          </div>

          {loading ? (
            <div className="space-y-3 px-6 py-6">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="h-9 w-9 shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-40 rounded bg-zinc-100 dark:bg-zinc-800" />
                    <div className="h-2.5 w-24 rounded bg-zinc-100 dark:bg-zinc-800" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="px-6 py-8 text-center text-sm text-rose-500">{error}</div>
          ) : users.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-zinc-400">No users yet.</div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {users.map((u, idx) => (
                <li
                  key={u.id}
                  style={{ animationDelay: `${Math.min(idx, 10) * 35}ms` }}
                  className="group flex animate-fade-in-up items-center gap-4 px-6 py-4 transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40"
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm ${avatarColor(u.email)}`}>
                    {avatarInitial(u.email)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      {u.email}
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${u.confirmed ? "bg-emerald-500" : "bg-amber-400"}`} />
                      {u.confirmed ? "Active" : "Invite pending"} ·{" "}
                      {u.lastSignIn
                        ? `Last sign-in ${new Date(u.lastSignIn).toLocaleDateString()}`
                        : "Never signed in"}
                    </p>
                  </div>
                  <select
                    value={u.role}
                    onChange={(e) =>
                      handleRoleChange(u.id, e.target.value as "admin" | "recruiter")
                    }
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium outline-none transition-colors ${
                      u.role === "admin"
                        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
                        : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    <option value="recruiter">Recruiter</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={() => handleDelete(u.id, u.email ?? "")}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs text-zinc-300 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-rose-500/10"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Teams & Projects — two-column drag-and-drop layout, added 2026-07-15.
            Left: team blocks (rename inline, members as before, projects as a
            drop zone). Right: a scrollable rail listing every project as a
            draggable source. Drop a project card onto a team block to assign
            it there (replaces its current team, single teamId per project —
            matches PATCH /api/projects/[id]'s admin-only teamId handling). */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
          <div className="rounded-2xl border border-zinc-200 bg-white transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Teams{teams.length > 0 && ` (${teams.length})`}
              </h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Recruiters see only projects and candidates belonging to their team. Click a team name to rename it; drag a project from the right onto a team to assign it.
              </p>
              {teamProjectError && <p className="mt-2 text-xs text-rose-500">{teamProjectError}</p>}
            </div>

            {teamsLoading ? (
              <div className="space-y-4 px-6 py-6">
                {[0, 1].map((i) => (
                  <div key={i} className="animate-pulse space-y-2">
                    <div className="h-4 w-32 rounded bg-zinc-100 dark:bg-zinc-800" />
                    <div className="h-16 rounded-xl bg-zinc-50 dark:bg-zinc-800/50" />
                  </div>
                ))}
              </div>
            ) : teams.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-300 dark:text-zinc-700">
                  <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p className="text-sm text-zinc-400">No teams yet — create one below to get started.</p>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {teams.map((team, idx) => {
                  const memberIds = new Set(team.members.map((m) => m.userId));
                  const available = users.filter((u) => !memberIds.has(u.id));
                  const teamProjects = projects.filter((p) => p.teamId === team.id);
                  const isDragOver = dragOverTeamId === team.id;
                  // Hash on the stable numeric id, not the (editable) name, so
                  // a team's accent color doesn't jump around every time it's
                  // renamed — purely decorative, but renaming shouldn't have
                  // visible side effects elsewhere on the page.
                  const palette = teamPalette(String(team.id));
                  return (
                    <li
                      key={team.id}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverTeamId(team.id);
                      }}
                      onDragLeave={() => setDragOverTeamId((cur) => (cur === team.id ? null : cur))}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragProjectId != null) handleAssignProject(dragProjectId, team.id);
                        setDragProjectId(null);
                        setDragOverTeamId(null);
                      }}
                      style={{ animationDelay: `${Math.min(idx, 8) * 50}ms` }}
                      className={`group animate-fade-in-up border-l-4 px-6 py-4 transition-all duration-200 ${palette.border} ${
                        isDragOver ? `${palette.soft} scale-[1.005]` : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-sm ${palette.dot}`}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
                              <circle cx="9" cy="7" r="4" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                          {editingTeamId === team.id ? (
                            <input
                              autoFocus
                              value={editingTeamName}
                              onChange={(e) => setEditingTeamName(e.target.value)}
                              onBlur={commitTeamRename}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitTeamRename();
                                if (e.key === "Escape") setEditingTeamId(null);
                              }}
                              disabled={renamingTeam}
                              className="rounded-lg border border-violet-300 bg-white px-2 py-1 text-sm font-medium text-zinc-800 focus:outline-none dark:border-violet-500/40 dark:bg-zinc-800 dark:text-zinc-200"
                            />
                          ) : (
                            <button
                              onClick={() => startEditingTeamName(team)}
                              className="truncate rounded px-1 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                              title="Click to rename"
                            >
                              {team.name}
                            </button>
                          )}
                        </div>
                        <button
                          onClick={() => handleDeleteTeam(team)}
                          className="shrink-0 rounded-lg px-2 py-1 text-xs text-zinc-400 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-rose-500/10"
                        >
                          Delete team
                        </button>
                      </div>

                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {team.members.length === 0 ? (
                          <span className="text-xs text-zinc-400">No members</span>
                        ) : (
                          team.members.map((m) => (
                            <span
                              key={m.userId}
                              className="flex items-center gap-1.5 rounded-full bg-zinc-100 py-1 pl-1 pr-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                            >
                              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${avatarColor(m.email ?? m.userId)}`}>
                                {avatarInitial(m.email ?? m.userId)}
                              </span>
                              {m.email ?? m.userId}
                              <button
                                onClick={() => handleRemoveMember(team.id, m.userId)}
                                className="text-zinc-400 hover:text-rose-500"
                                aria-label={`Remove ${m.email ?? "member"} from ${team.name}`}
                              >
                                ×
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                      {available.length > 0 && (
                        <div data-team-picker className="relative z-50 mt-3 inline-block">
                          <button
                            onClick={() =>
                              setOpenMemberPickerTeamId((cur) => (cur === team.id ? null : team.id))
                            }
                            className={`flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs font-medium transition-colors ${
                              openMemberPickerTeamId === team.id
                                ? `${palette.border} ${palette.soft} ${palette.text}`
                                : "border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600 dark:text-zinc-400 dark:hover:text-zinc-200"
                            }`}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                            </svg>
                            Add member
                          </button>
                          {openMemberPickerTeamId === team.id && (
                            <div className="absolute left-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-800">
                              <ul className="max-h-52 overflow-y-auto">
                                {available.map((u) => (
                                  <li key={u.id}>
                                    <button
                                      onClick={() => handleAddMember(team.id, u.id)}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
                                    >
                                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${avatarColor(u.email)}`}>
                                        {avatarInitial(u.email)}
                                      </span>
                                      <span className="truncate">{u.email}</span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Assigned projects — drop target; chips mirror the member-chip pattern above */}
                      <div
                        className={`mt-3 rounded-xl border border-dashed px-3 py-2.5 transition-all duration-200 ${
                          isDragOver
                            ? `${palette.border} ${palette.soft} ring-2 ${palette.ring} scale-[1.01]`
                            : "border-zinc-200 dark:border-zinc-700"
                        }`}
                      >
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            Projects{teamProjects.length > 0 && ` (${teamProjects.length})`}
                          </p>
                          {/* Click-to-add alternative to drag-and-drop, 2026-07-15 (Vlad's
                              ask) — same handleAssignProject the drop zone already uses,
                              just triggered by a pick instead of a drop. Lists every
                              project not already on this team (assigning replaces a
                              project's current team, so an already-assigned one would
                              be a no-op here). */}
                          {projects.some((p) => p.teamId !== team.id) && (
                            <div data-team-picker className="relative z-50">
                              <button
                                onClick={() =>
                                  setOpenProjectPickerTeamId((cur) => (cur === team.id ? null : team.id))
                                }
                                title="Add a project"
                                className={`flex h-4 w-4 items-center justify-center rounded-full border border-dashed transition-colors ${
                                  openProjectPickerTeamId === team.id
                                    ? `${palette.border} ${palette.soft} ${palette.text}`
                                    : "border-zinc-300 text-zinc-400 hover:border-zinc-400 hover:text-zinc-600 dark:border-zinc-600 dark:hover:text-zinc-300"
                                }`}
                              >
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                  <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                                </svg>
                              </button>
                              {openProjectPickerTeamId === team.id && (
                                <div className="absolute right-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-800">
                                  <ul className="max-h-52 overflow-y-auto">
                                    {projects.filter((p) => p.teamId !== team.id).map((p) => (
                                      <li key={p.id}>
                                        <button
                                          onClick={() => handleAssignProject(p.id, team.id)}
                                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
                                        >
                                          <span className="truncate">{p.name}</span>
                                          <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">
                                            {p.teamName ?? "Unassigned"}
                                          </span>
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        {teamProjects.length === 0 ? (
                          <span className={`flex items-center gap-1.5 text-xs ${isDragOver ? palette.text : "text-zinc-400"}`}>
                            {isDragOver && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-bounce">
                                <path d="M12 5v14M19 12l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                            {isDragOver ? "Release to assign" : "Drop a project here to assign it"}
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {teamProjects.map((p) => (
                              <span
                                key={p.id}
                                className={`animate-pop-in flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${palette.soft} ${palette.text}`}
                              >
                                {p.name}
                                <button
                                  onClick={() => handleAssignProject(p.id, null)}
                                  className="text-current opacity-60 hover:opacity-100 hover:text-rose-500"
                                  aria-label={`Remove ${p.name} from ${team.name}`}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <form onSubmit={handleCreateTeam} className="flex items-end gap-3 border-t border-zinc-100 px-6 py-4 dark:border-zinc-800">
              <div className="flex flex-1 flex-col gap-1.5">
                <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">New team name</label>
                <input
                  type="text"
                  required
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="e.g. West Coast Team"
                  className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <button
                type="submit"
                disabled={creatingTeam}
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:-translate-y-px hover:bg-violet-700 hover:shadow-md hover:shadow-violet-500/30 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
              >
                {creatingTeam ? "Creating…" : "Create team"}
              </button>
            </form>
            {teamError && <p className="px-6 pb-4 text-sm text-rose-500">{teamError}</p>}
          </div>

          {/* Projects rail — drag source, every project regardless of team */}
          <div className="rounded-2xl border border-zinc-200 bg-white transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 lg:self-start">
            <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Projects{projects.length > 0 && ` (${projects.length})`}
              </h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Drag onto a team to assign.</p>
              {projects.length > 5 && (
                <div className="relative mt-2.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400">
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" strokeLinecap="round" />
                  </svg>
                  <input
                    type="text"
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    placeholder="Filter projects…"
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-3 text-xs text-zinc-700 placeholder-zinc-400 focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:placeholder-zinc-500"
                  />
                </div>
              )}
            </div>
            {projectsLoading ? (
              <div className="space-y-3 px-5 py-6">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="animate-pulse space-y-1.5">
                    <div className="h-3 w-32 rounded bg-zinc-100 dark:bg-zinc-800" />
                    <div className="h-2.5 w-16 rounded bg-zinc-100 dark:bg-zinc-800" />
                  </div>
                ))}
              </div>
            ) : projects.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-zinc-400">No projects yet.</div>
            ) : (() => {
                const visibleProjects = projects.filter((p) =>
                  p.name.toLowerCase().includes(projectSearch.toLowerCase())
                );
                return visibleProjects.length === 0 ? (
                  <div className="px-5 py-8 text-center text-sm text-zinc-400">No projects match &ldquo;{projectSearch}&rdquo;.</div>
                ) : (
                  <ul className="max-h-[32rem] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
                    {visibleProjects.map((p) => {
                      // Match the team card's dot exactly — same id-based hash,
                      // not the name, so a project's accent stays put across a
                      // team rename.
                      const palette = p.teamId != null ? teamPalette(String(p.teamId)) : null;
                      return (
                        <li
                          key={p.id}
                          draggable
                          onDragStart={(e) => {
                            setDragProjectId(p.id);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => {
                            setDragProjectId(null);
                            setDragOverTeamId(null);
                          }}
                          className={`group flex cursor-grab items-center gap-2 px-5 py-3 transition-all duration-150 active:cursor-grabbing ${
                            dragProjectId === p.id
                              ? "scale-95 opacity-40 shadow-inner"
                              : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                          }`}
                        >
                          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" className="shrink-0 text-zinc-300 dark:text-zinc-700">
                            <circle cx="2" cy="2" r="1.3" /><circle cx="8" cy="2" r="1.3" />
                            <circle cx="2" cy="7" r="1.3" /><circle cx="8" cy="7" r="1.3" />
                            <circle cx="2" cy="12" r="1.3" /><circle cx="8" cy="12" r="1.3" />
                          </svg>
                          <span className={`h-2 w-2 shrink-0 rounded-full ${palette ? palette.dot : "bg-zinc-200 dark:bg-zinc-700"}`} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{p.name}</p>
                            <p className={`mt-0.5 truncate text-xs ${palette ? palette.text : "text-zinc-400 dark:text-zinc-500"}`}>
                              {p.teamName ?? "Unassigned"}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
          </div>
        </div>
      </div>
    </div>
  );
}
