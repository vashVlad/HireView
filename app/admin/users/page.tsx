"use client";

import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";

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
  const [addMemberSelection, setAddMemberSelection] = useState<Record<number, string>>({});

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

  useEffect(() => {
    fetchUsers();
    fetchRequests();
    fetchTeams();
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

  async function handleAddMember(teamId: number) {
    const userId = addMemberSelection[teamId];
    if (!userId) return;
    const addedUser = users.find((u) => u.id === userId);

    // Optimistic update — the chip and the "available to add" dropdown
    // reflect the change instantly instead of waiting on a round trip.
    // fetchTeams() below still runs to reconcile with server truth.
    setTeams((prev) =>
      prev.map((t) =>
        t.id === teamId && !t.members.some((m) => m.userId === userId)
          ? { ...t, members: [...t.members, { userId, email: addedUser?.email ?? null }] }
          : t
      )
    );
    setAddMemberSelection((prev) => ({ ...prev, [teamId]: "" }));

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
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">User Management</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Invite recruiters and manage access. Admin role required.
          </p>
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
        <div className="mb-8 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
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
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
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
        <div className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Team members{users.length > 0 && ` (${users.length})`}
            </h2>
          </div>

          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-zinc-400">Loading…</div>
          ) : error ? (
            <div className="px-6 py-8 text-center text-sm text-rose-500">{error}</div>
          ) : users.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-zinc-400">No users yet.</div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {users.map((u) => (
                <li key={u.id} className="flex items-center gap-4 px-6 py-4">
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      {u.email}
                    </p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
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
                    className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  >
                    <option value="recruiter">Recruiter</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={() => handleDelete(u.id, u.email ?? "")}
                    className="rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Teams */}
        <div className="mt-8 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Teams{teams.length > 0 && ` (${teams.length})`}
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Recruiters see only projects and candidates belonging to their team. Admins see everything.
            </p>
          </div>

          {teamsLoading ? (
            <div className="px-6 py-8 text-center text-sm text-zinc-400">Loading…</div>
          ) : teams.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-zinc-400">No teams yet.</div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {teams.map((team) => {
                const memberIds = new Set(team.members.map((m) => m.userId));
                const available = users.filter((u) => !memberIds.has(u.id));
                return (
                  <li key={team.id} className="px-6 py-4">
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{team.name}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {team.members.length === 0 ? (
                        <span className="text-xs text-zinc-400">No members</span>
                      ) : (
                        team.members.map((m) => (
                          <span
                            key={m.userId}
                            className="flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          >
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
                      <div className="mt-3 flex items-center gap-2">
                        <select
                          value={addMemberSelection[team.id] ?? ""}
                          onChange={(e) =>
                            setAddMemberSelection((prev) => ({ ...prev, [team.id]: e.target.value }))
                          }
                          className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                          <option value="">Add member…</option>
                          {available.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.email}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleAddMember(team.id)}
                          disabled={!addMemberSelection[team.id]}
                          className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                          Add
                        </button>
                      </div>
                    )}
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
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {creatingTeam ? "Creating…" : "Create team"}
            </button>
          </form>
          {teamError && <p className="px-6 pb-4 text-sm text-rose-500">{teamError}</p>}
        </div>
      </div>
    </div>
  );
}
